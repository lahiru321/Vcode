import { getDatabase } from '../db';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspaceChanges,
  getWorkspaceFolder,
  listWorkspaces,
} from '../workspaces/service';
import { openInVsCode } from '../workspaces/open';
import { platform } from '../platform';
import { handle } from './registry';

export function registerWorkspaceHandlers(): void {
  handle('workspaces:list', ({ projectId }) => listWorkspaces(getDatabase(), projectId));
  handle('workspaces:create', (request) => createWorkspace(getDatabase(), request));
  handle('workspaces:delete', ({ id, force }) => deleteWorkspace(getDatabase(), id, force));
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
