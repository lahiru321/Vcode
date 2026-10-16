import { mkdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  IpcError,
  slugify,
  type CreateWorkspaceRequest,
  type WorkspaceChanges,
  type WorkspaceStatus,
} from '@vcode/shared';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { repositories, terminalSessions, workspaces } from '../db/schema';
import { planWorkspaceFolder, resolveWorkspaceFolder } from '../fs/folders';
import { detectGitRepository } from '../git/detect';
import {
  addWorktree,
  excludeFolder,
  pruneWorktrees,
  removeWorktree,
  uncommittedChanges,
} from '../git/worktrees';
import { getProject, type ProjectRow } from '../projects/service';

// Workspaces (V1 doc §8, §17): where a project's terminals run. Every project has a `main` one,
// its root folder. Folder workspaces (P6-03) are a folder inside the project: a new one under
// `workspaces/`, or one that already exists. Worktree workspaces (P6-04) are a branch checked out
// with `git worktree` in `workspaces/<name>`. Every path goes through the P6-05 guards, so it
// stays inside the project root.

export type WorkspaceRow = typeof workspaces.$inferSelect;
type Queryable = Pick<AppDatabase, 'select'>;

export const MAIN_WORKSPACE_NAME = 'main';
/** New folder workspaces go in `<project root>/workspaces/<name>` (V1 doc §17). */
export const WORKSPACES_FOLDER = 'workspaces';

/** The project's `main` workspace, created on first use. */
export function ensureMainWorkspace(db: AppDatabase, project: ProjectRow): WorkspaceRow {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.projectId, project.id), eq(workspaces.kind, 'main')))
      .get();
    if (existing) {
      return existing;
    }
    const repository = tx
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.projectId, project.id))
      .get();
    return tx
      .insert(workspaces)
      .values({
        projectId: project.id,
        name: MAIN_WORKSPACE_NAME,
        path: project.rootPath,
        kind: 'main',
        repositoryId: repository?.id ?? null,
        branch: project.defaultBranch,
      })
      .returning()
      .get();
  });
}

/** A workspace of `projectId`; NOT_FOUND if it doesn't exist or belongs to another project. */
export function getWorkspace(db: AppDatabase, id: string, projectId: string): WorkspaceRow {
  const workspace = db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.projectId, projectId)))
    .get();
  if (!workspace) {
    throw new IpcError('NOT_FOUND', 'Workspace not found. It may have been deleted.');
  }
  return workspace;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** `ready` if the folder passes the path guards now, `missing` if it's gone, else `error`. */
async function checkStatus(project: ProjectRow, workspace: WorkspaceRow): Promise<WorkspaceStatus> {
  try {
    await resolveWorkspaceFolder(project.rootPath, workspace.path);
    return 'ready';
  } catch {
    return (await exists(workspace.path)) ? 'error' : 'missing';
  }
}

/**
 * The project's workspaces, `main` first (created if missing), then by name. Each folder is
 * checked now and its status saved: `missing` when it's gone, `error` when it no longer passes
 * the path guards (e.g. swapped for a link out of the project). Branches are read again too
 * (P6-06): `main` and folder workspaces show what the project folder has checked out (they are
 * the same working tree), a worktree what it has.
 */
export async function listWorkspaces(db: AppDatabase, projectId: string): Promise<WorkspaceRow[]> {
  const project = getProject(db, projectId);
  const main = ensureMainWorkspace(db, project);
  const projectBranch = (await detectGitRepository(project.rootPath))?.branch ?? null;
  const others = db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.projectId, projectId), ne(workspaces.kind, 'main')))
    .orderBy(sql`${workspaces.name} collate nocase`)
    .all();

  return Promise.all(
    [main, ...others].map(async (workspace) => {
      const status = await checkStatus(project, workspace);
      let { branch } = workspace;
      if (workspace.kind !== 'worktree') {
        branch = projectBranch;
      } else if (status === 'ready') {
        branch = (await detectGitRepository(workspace.path))?.branch ?? null;
      }
      if (status === workspace.status && branch === workspace.branch) {
        return workspace;
      }
      db.update(workspaces).set({ status, branch }).where(eq(workspaces.id, workspace.id)).run();
      return { ...workspace, status, branch };
    }),
  );
}

function assertNameFree(db: Queryable, projectId: string, name: string): void {
  const taken = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(eq(workspaces.projectId, projectId), sql`${workspaces.name} = ${name} collate nocase`),
    )
    .get();
  if (taken || name.toLowerCase() === MAIN_WORKSPACE_NAME) {
    throw new IpcError('CONFLICT', `There is already a workspace named “${name}”.`);
  }
}

function assertPathFree(db: Queryable, path: string): void {
  const owner = db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.path, path))
    .get();
  if (owner) {
    throw new IpcError('CONFLICT', `The workspace “${owner.name}” already uses this folder.`);
  }
}

/**
 * A new workspace.
 * - `folder` with `path`: that existing folder inside the project (not the root — that's
 *   `main`). Without: `workspaces/<name>` in the project, created if needed (a folder left from an
 *   earlier workspace of that name is reused).
 * - `worktree`: `branch` checked out in a new worktree at `workspaces/<name>`; the project must be
 *   a Git repository.
 */
export async function createWorkspace(
  db: AppDatabase,
  request: CreateWorkspaceRequest,
): Promise<WorkspaceRow> {
  const project = getProject(db, request.projectId);
  if (project.status === 'archived') {
    throw new IpcError('CONFLICT', 'Restore the project to add workspaces to it.');
  }
  const { name } = request;
  assertNameFree(db, project.id, name);

  if (request.kind === 'worktree') {
    return createWorktreeWorkspace(db, project, request);
  }

  let folder: string;
  if (request.path !== undefined) {
    folder = await resolveWorkspaceFolder(project.rootPath, request.path);
    if (folder === (await resolveWorkspaceFolder(project.rootPath, '.'))) {
      throw new IpcError(
        'INVALID_REQUEST',
        'That is the project folder itself, which the main workspace already uses.',
      );
    }
  } else {
    const planned = await planWorkspaceFolder(project.rootPath, newFolderFor(name));
    assertPathFree(db, planned);
    await mkdir(planned, { recursive: true });
    // Checked again now that it exists: nothing on the way may have become a link meanwhile.
    folder = await resolveWorkspaceFolder(project.rootPath, planned);
  }

  return insertWorkspace(db, project, { name, path: folder, kind: 'folder' });
}

/** `workspaces/<slug of name>`, relative to the project root. */
function newFolderFor(name: string): string {
  return join(WORKSPACES_FOLDER, slugify(name, 'workspace'));
}

function insertWorkspace(
  db: AppDatabase,
  project: ProjectRow,
  values: Pick<WorkspaceRow, 'name' | 'path' | 'kind'> &
    Partial<Pick<WorkspaceRow, 'branch' | 'repositoryId'>>,
): WorkspaceRow {
  return db.transaction((tx) => {
    // Again inside the transaction, so two creates can't both pass.
    assertNameFree(tx, project.id, values.name);
    assertPathFree(tx, values.path);
    return tx
      .insert(workspaces)
      .values({ projectId: project.id, ...values })
      .returning()
      .get();
  });
}

async function createWorktreeWorkspace(
  db: AppDatabase,
  project: ProjectRow,
  request: Extract<CreateWorkspaceRequest, { kind: 'worktree' }>,
): Promise<WorkspaceRow> {
  const root = project.rootPath;
  if (!(await detectGitRepository(root))) {
    throw new IpcError(
      'INVALID_REQUEST',
      `“${project.name}” isn’t a Git repository, so it can’t have worktrees. Use a folder workspace instead.`,
    );
  }
  const planned = await planWorkspaceFolder(root, newFolderFor(request.name));
  assertPathFree(db, planned);
  if (await exists(planned)) {
    throw new IpcError(
      'CONFLICT',
      `${planned} already exists. Choose another name, or delete or move that folder.`,
    );
  }

  await addWorktree(root, planned, request.branch, request.startPoint);
  // Checked again now that it exists, as for folder workspaces.
  const folder = await resolveWorkspaceFolder(root, planned);
  await excludeFolder(root, WORKSPACES_FOLDER);

  const repository = db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.projectId, project.id))
    .get();
  const branch = (await detectGitRepository(folder))?.branch ?? request.branch;
  try {
    return insertWorkspace(db, project, {
      name: request.name,
      path: folder,
      kind: 'worktree',
      branch,
      repositoryId: repository?.id ?? null,
    });
  } catch (error) {
    // Lost a race for the name or folder: take back the worktree just made (nothing is in it).
    await removeWorktree(root, folder, true).catch(() => undefined);
    throw error;
  }
}

/** A workspace's folder, checked against the path guards now (it may have moved or changed). */
export async function getWorkspaceFolder(db: AppDatabase, id: string): Promise<string> {
  const workspace = findWorkspace(db, id);
  const project = getProject(db, workspace.projectId);
  return resolveWorkspaceFolder(project.rootPath, workspace.path);
}

function findWorkspace(db: AppDatabase, id: string): WorkspaceRow {
  const workspace = db.select().from(workspaces).where(eq(workspaces.id, id)).get();
  if (!workspace) {
    throw new IpcError('NOT_FOUND', 'Workspace not found. It may have been deleted.');
  }
  return workspace;
}

const LISTED_CHANGES = 20;

/**
 * Uncommitted changes in a workspace: a worktree's own; for `main` the whole project folder's;
 * for a folder workspace those inside its folder. Null when there's nothing to check: the folder
 * isn't there (or no longer inside the project), or it isn't in a Git repository.
 */
export async function getWorkspaceChanges(
  db: AppDatabase,
  id: string,
): Promise<WorkspaceChanges | null> {
  const workspace = findWorkspace(db, id);
  const project = getProject(db, workspace.projectId);
  if ((await checkStatus(project, workspace)) !== 'ready') {
    return null;
  }
  const changes = await changesIn(project, workspace);
  return changes && { count: changes.length, files: changes.slice(0, LISTED_CHANGES) };
}

/** `git status` lines for a workspace whose folder is ready; null if it isn't in a repository. */
async function changesIn(project: ProjectRow, workspace: WorkspaceRow): Promise<string[] | null> {
  // Its own repository root only: in a folder without one, git would report the project's.
  const gitRoot = workspace.kind === 'worktree' ? workspace.path : project.rootPath;
  if (!(await detectGitRepository(gitRoot))) {
    return null;
  }
  if (workspace.kind === 'folder') {
    return uncommittedChanges(gitRoot, relative(project.rootPath, workspace.path));
  }
  return uncommittedChanges(gitRoot);
}

/**
 * Deletes a workspace. CONFLICT for `main` and while a terminal is running in it. Its ended
 * terminals and agent runs go with it.
 * - Folder workspaces: only the record; the folder and files stay on disk.
 * - Worktrees: `git worktree remove` takes the folder away too (the branch stays). With
 *   uncommitted changes, CONFLICT unless `force`. A folder that's gone is pruned from git; one
 *   that no longer passes the path guards is left alone, and only the record goes.
 */
export async function deleteWorkspace(
  db: AppDatabase,
  id: string,
  force = false,
): Promise<{ id: string; removedFolder: boolean }> {
  const workspace = findWorkspace(db, id);
  if (workspace.kind === 'main') {
    throw new IpcError('CONFLICT', 'The main workspace is the project folder itself and stays.');
  }
  assertNoRunningTerminals(db, workspace);

  let removedFolder = false;
  if (workspace.kind === 'worktree') {
    const project = getProject(db, workspace.projectId);
    const status = await checkStatus(project, workspace);
    if (status === 'ready') {
      if (!force) {
        const length = (await changesIn(project, workspace))?.length ?? 0;
        if (length > 0) {
          const changes = length === 1 ? '1 uncommitted change' : `${length} uncommitted changes`;
          throw new IpcError(
            'CONFLICT',
            `“${workspace.name}” has ${changes}. Commit or discard them first, or delete it anyway.`,
          );
        }
      }
      // A terminal may have been started while git was busy.
      assertNoRunningTerminals(db, workspace);
      await removeWorktree(project.rootPath, workspace.path, force);
      removedFolder = true;
    } else if (status === 'missing') {
      await pruneWorktrees(project.rootPath);
    }
  }

  db.delete(workspaces).where(eq(workspaces.id, id)).run();
  return { id, removedFolder };
}

function assertNoRunningTerminals(db: AppDatabase, workspace: WorkspaceRow): void {
  const running = db
    .select({ id: terminalSessions.id })
    .from(terminalSessions)
    .where(
      and(
        eq(terminalSessions.workspaceId, workspace.id),
        inArray(terminalSessions.status, ['starting', 'running']),
      ),
    )
    .all();
  if (running.length > 0) {
    const count = running.length === 1 ? 'A terminal is' : `${running.length} terminals are`;
    throw new IpcError(
      'CONFLICT',
      `${count} running in “${workspace.name}”. Stop or close them before deleting it.`,
    );
  }
}
