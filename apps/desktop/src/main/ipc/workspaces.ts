import { getDatabase } from '../db';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspaceChanges,
  listWorkspaces,
} from '../workspaces/service';
import { handle } from './registry';

export function registerWorkspaceHandlers(): void {
  handle('workspaces:list', ({ projectId }) => listWorkspaces(getDatabase(), projectId));
  handle('workspaces:create', (request) => createWorkspace(getDatabase(), request));
  handle('workspaces:delete', ({ id, force }) => deleteWorkspace(getDatabase(), id, force));
  handle('workspaces:changes', ({ id }) => getWorkspaceChanges(getDatabase(), id));
}
