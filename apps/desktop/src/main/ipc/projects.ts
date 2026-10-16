import { recordAudit } from '../audit/service';
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
  handle('projects:create', async (request) => {
    const project = await createProject(getDatabase(), request);
    recordAudit(getDatabase(), {
      projectId: project.id,
      action: 'project.create',
      resourceType: 'project',
      resourceId: project.id,
      metadata: { name: project.name, path: project.rootPath },
    });
    return project;
  });
  handle('projects:update', (request) => updateProject(getDatabase(), request));
  handle('projects:delete', ({ id }) => {
    const before = getProject(getDatabase(), id);
    const result = deleteProject(getDatabase(), id);
    // The project is gone, so the entry is app-wide; its name and folder say which it was.
    recordAudit(getDatabase(), {
      action: 'project.delete',
      resourceType: 'project',
      resourceId: id,
      metadata: { name: before.name, path: before.rootPath },
    });
    return result;
  });
  handle('projects:getLayout', ({ id }) => getProjectLayout(getDatabase(), id));
  handle('projects:saveLayout', ({ id, layout }) => saveProjectLayout(getDatabase(), id, layout));
}
