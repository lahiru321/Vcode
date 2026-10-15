import { getDatabase } from '../db';
import {
  createProject,
  deleteProject,
  getProject,
  getProjectLayout,
  listProjects,
  saveProjectLayout,
  updateProject,
} from '../projects/service';
import { handle } from './registry';

export function registerProjectHandlers(): void {
  handle('projects:list', () => listProjects(getDatabase()));
  handle('projects:get', ({ id }) => getProject(getDatabase(), id));
  handle('projects:create', (request) => createProject(getDatabase(), request));
  handle('projects:update', (request) => updateProject(getDatabase(), request));
  handle('projects:delete', ({ id }) => deleteProject(getDatabase(), id));
  handle('projects:getLayout', ({ id }) => getProjectLayout(getDatabase(), id));
  handle('projects:saveLayout', ({ id, layout }) => saveProjectLayout(getDatabase(), id, layout));
}
