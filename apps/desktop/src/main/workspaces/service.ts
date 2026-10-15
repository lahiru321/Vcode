import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  IpcError,
  slugify,
  type CreateWorkspaceRequest,
  type WorkspaceStatus,
} from '@vcode/shared';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { repositories, terminalSessions, workspaces } from '../db/schema';
import { planWorkspaceFolder, resolveWorkspaceFolder } from '../fs/folders';
import { getProject, type ProjectRow } from '../projects/service';

// Workspaces (V1 doc §8, §17): where a project's terminals run. Every project has a `main` one,
// its root folder. Folder workspaces (P6-03) are a folder inside the project: a new one under
// `workspaces/`, or one that already exists. Git worktrees come with P6-04. Every path goes
// through the P6-05 guards, so it stays inside the project root.

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
 * the path guards (e.g. swapped for a link out of the project).
 */
export async function listWorkspaces(db: AppDatabase, projectId: string): Promise<WorkspaceRow[]> {
  const project = getProject(db, projectId);
  const main = ensureMainWorkspace(db, project);
  const others = db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.projectId, projectId), ne(workspaces.kind, 'main')))
    .orderBy(sql`${workspaces.name} collate nocase`)
    .all();

  return Promise.all(
    [main, ...others].map(async (workspace) => {
      const status = await checkStatus(project, workspace);
      if (status === workspace.status) {
        return workspace;
      }
      db.update(workspaces).set({ status }).where(eq(workspaces.id, workspace.id)).run();
      return { ...workspace, status };
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
 * A new folder workspace. With `path`: that existing folder inside the project (not the root —
 * that's `main`). Without: `workspaces/<name>` in the project, created if needed (a folder left
 * from an earlier workspace of that name is reused).
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
    const planned = await planWorkspaceFolder(
      project.rootPath,
      join(WORKSPACES_FOLDER, slugify(name, 'workspace')),
    );
    assertPathFree(db, planned);
    await mkdir(planned, { recursive: true });
    // Checked again now that it exists: nothing on the way may have become a link meanwhile.
    folder = await resolveWorkspaceFolder(project.rootPath, planned);
  }

  return db.transaction((tx) => {
    // Again inside the transaction, so two creates can't both pass.
    assertNameFree(tx, project.id, name);
    assertPathFree(tx, folder);
    return tx
      .insert(workspaces)
      .values({ projectId: project.id, name, path: folder, kind: request.kind })
      .returning()
      .get();
  });
}

/**
 * Removes a workspace's record; its folder and files stay on disk. CONFLICT for `main` and
 * while a terminal is running in it. Its ended terminals and agent runs go with it.
 */
export function deleteWorkspace(db: AppDatabase, id: string): { id: string } {
  const workspace = db.select().from(workspaces).where(eq(workspaces.id, id)).get();
  if (!workspace) {
    throw new IpcError('NOT_FOUND', 'Workspace not found. It may have been deleted.');
  }
  if (workspace.kind === 'main') {
    throw new IpcError('CONFLICT', 'The main workspace is the project folder itself and stays.');
  }
  const running = db
    .select({ id: terminalSessions.id })
    .from(terminalSessions)
    .where(
      and(
        eq(terminalSessions.workspaceId, id),
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
  db.delete(workspaces).where(eq(workspaces.id, id)).run();
  return { id };
}
