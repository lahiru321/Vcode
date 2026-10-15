import { getDatabase } from '../db';
import { createWorkspace, deleteWorkspace, listWorkspaces } from '../workspaces/service';
import { handle } from './registry';

export function registerWorkspaceHandlers(): void {
  handle('workspaces:list', ({ projectId }) => listWorkspaces(getDatabase(), projectId));
  handle('workspaces:create', (request) => createWorkspace(getDatabase(), request));
  handle('workspaces:delete', ({ id }) => deleteWorkspace(getDatabase(), id));
}
