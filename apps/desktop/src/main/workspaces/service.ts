import { IpcError } from '@vcode/shared';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { workspaces } from '../db/schema';
import type { ProjectRow } from '../projects/service';

// Workspaces (V1 doc §8, §17). For now only each project's `main` workspace — its root folder —
// which terminals open in by default. Folder and Git worktree workspaces come in P6.

export type WorkspaceRow = typeof workspaces.$inferSelect;

export const MAIN_WORKSPACE_NAME = 'main';

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
    return tx
      .insert(workspaces)
      .values({
        projectId: project.id,
        name: MAIN_WORKSPACE_NAME,
        path: project.rootPath,
        kind: 'main',
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
