import { getDatabase } from '../db';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from '../projects/service';
import { handle } from './registry';

export function registerProjectHandlers(): void {
  handle('projects:list', () => listProjects(getDatabase()));
  handle('projects:get', ({ id }) => getProject(getDatabase(), id));
  handle('projects:create', (request) => createProject(getDatabase(), request));
  handle('projects:update', (request) => updateProject(getDatabase(), request));
  handle('projects:delete', ({ id }) => deleteProject(getDatabase(), id));
}
