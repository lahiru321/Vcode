import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workspaces } from '../db/schema';
import { createProject } from '../projects/service';
import { tempDir, testDatabase } from '../testing';
import { listWorkspaces } from './service';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('listWorkspaces', () => {
  it("creates the project's main workspace on first use", async () => {
    const db = testDatabase();
    const project = await createProject(db, { rootPath: tempDir() });
    const list = listWorkspaces(db, project.id);
    expect(list).toEqual([
      expect.objectContaining({ name: 'main', kind: 'main', path: project.rootPath }),
    ]);
    expect(listWorkspaces(db, project.id)).toEqual(list);
  });

  it('lists main first, then the others by name, for that project only', async () => {
    const db = testDatabase();
    const root = tempDir();
    const project = await createProject(db, { rootPath: root });
    const other = await createProject(db, { rootPath: tempDir() });
    for (const name of ['zeta', 'alpha']) {
      mkdirSync(join(root, name));
      db.insert(workspaces)
        .values({ projectId: project.id, name, path: join(root, name), kind: 'folder' })
        .run();
    }
    listWorkspaces(db, other.id);

    expect(listWorkspaces(db, project.id).map((w) => w.name)).toEqual(['main', 'alpha', 'zeta']);
    expect(listWorkspaces(db, other.id).map((w) => w.name)).toEqual(['main']);
  });

  it('fails for an unknown project', () => {
    expect(() => listWorkspaces(testDatabase(), MISSING_ID)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});
