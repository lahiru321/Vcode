import { getDatabase } from '../db';
import {
  createWorkspace,
  deleteWorkspace,
  findWorkspace,
  getWorkspaceChanges,
  getWorkspaceFolder,
  listWorkspaces,
} from '../workspaces/service';
import { recordAudit } from '../audit/service';
import { openInVsCode } from '../workspaces/open';
import { platform } from '../platform';
import { handle } from './registry';

export function registerWorkspaceHandlers(): void {
  handle('workspaces:list', ({ projectId }) => listWorkspaces(getDatabase(), projectId));
  handle('workspaces:create', async (request) => {
    const workspace = await createWorkspace(getDatabase(), request);
    recordAudit(getDatabase(), {
      projectId: workspace.projectId,
      action: 'workspace.create',
      resourceType: 'workspace',
      resourceId: workspace.id,
      metadata: {
        name: workspace.name,
        kind: workspace.kind,
        path: workspace.path,
        branch: workspace.branch,
      },
    });
    return workspace;
  });
  handle('workspaces:delete', async ({ id, force }) => {
    const before = findWorkspace(getDatabase(), id);
    const result = await deleteWorkspace(getDatabase(), id, force);
    recordAudit(getDatabase(), {
      projectId: before.projectId,
      action: 'workspace.delete',
      resourceType: 'workspace',
      resourceId: id,
      metadata: {
        name: before.name,
        kind: before.kind,
        path: before.path,
        branch: before.branch,
        removedFolder: result.removedFolder,
        force: force || undefined,
      },
    });
    return result;
  });
  handle('workspaces:changes', ({ id }) => getWorkspaceChanges(getDatabase(), id));
  handle('workspaces:reveal', async ({ id }) => {
    platform.revealInFileManager(await getWorkspaceFolder(getDatabase(), id));
    return null;
  });
  handle('workspaces:openInEditor', async ({ id }) => {
    await openInVsCode(await getWorkspaceFolder(getDatabase(), id));
    return null;
  });
}
