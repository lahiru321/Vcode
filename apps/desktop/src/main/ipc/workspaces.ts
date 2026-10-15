import { getDatabase } from '../db';
import { listWorkspaces } from '../workspaces/service';
import { handle } from './registry';

export function registerWorkspaceHandlers(): void {
  handle('workspaces:list', ({ projectId }) => listWorkspaces(getDatabase(), projectId));
}
