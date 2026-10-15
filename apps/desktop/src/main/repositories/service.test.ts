import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { repositories } from '../db/schema';
import { createProject, getProject } from '../projects/service';
import { tempDir, testDatabase } from '../testing';
import { listWorkspaces } from '../workspaces/service';
import { getRepository } from './service';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

/** Makes `folder` a repository on `branch`, with origin pointing at `url` if given. */
function makeRepo(folder: string, branch: string, url?: string): void {
  mkdirSync(join(folder, '.git'), { recursive: true });
  writeFileSync(join(folder, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  if (url) {
    writeFileSync(join(folder, '.git', 'config'), `[remote "origin"]\n\turl = ${url}\n`);
  }
}

describe('repositories', () => {
  it('records the repository when a project is created', async () => {
    const db = testDatabase();
    const root = tempDir();
    makeRepo(root, 'main', 'https://user:secret@github.com/me/shop.git');
    const project = await createProject(db, { rootPath: root });

    expect(db.select().from(repositories).all()).toEqual([
      expect.objectContaining({
        projectId: project.id,
        localPath: root,
        remoteUrl: 'https://github.com/me/shop.git',
        defaultBranch: 'main',
      }),
    ]);
    const [main] = await listWorkspaces(db, project.id);
    expect(main).toMatchObject({ repositoryId: expect.any(String), branch: 'main' });
  });

  it('records nothing for a plain folder', async () => {
    const db = testDatabase();
    const project = await createProject(db, { rootPath: tempDir() });
    await expect(getRepository(db, project.id)).resolves.toBeNull();
    expect(db.select().from(repositories).all()).toEqual([]);
  });

  it('picks up a folder that became a repository, and updates it in place', async () => {
    const db = testDatabase();
    const root = tempDir();
    const project = await createProject(db, { rootPath: root });
    await listWorkspaces(db, project.id);

    makeRepo(root, 'dev');
    const first = await getRepository(db, project.id);
    expect(first).toMatchObject({ remoteUrl: null, defaultBranch: 'dev' });
    expect(getProject(db, project.id).defaultBranch).toBe('dev');
    expect((await listWorkspaces(db, project.id))[0]).toMatchObject({
      repositoryId: first!.id,
      branch: 'dev',
    });

    makeRepo(root, 'feature', 'git@github.com:me/shop.git');
    const second = await getRepository(db, project.id);
    expect(second).toMatchObject({
      id: first!.id,
      remoteUrl: 'git@github.com:me/shop.git',
      defaultBranch: 'feature',
    });
    expect(db.select().from(repositories).all()).toHaveLength(1);
  });

  it('forgets the repository when .git goes away', async () => {
    const db = testDatabase();
    const root = tempDir();
    makeRepo(root, 'main');
    const project = await createProject(db, { rootPath: root });
    await listWorkspaces(db, project.id);

    rmSync(join(root, '.git'), { recursive: true });
    await expect(getRepository(db, project.id)).resolves.toBeNull();
    expect(getProject(db, project.id).defaultBranch).toBeNull();
    expect((await listWorkspaces(db, project.id))[0]).toMatchObject({
      repositoryId: null,
      branch: null,
    });
    expect(
      db.select().from(repositories).where(eq(repositories.projectId, project.id)).all(),
    ).toEqual([]);
  });

  it('fails for an unknown project', async () => {
    await expect(getRepository(testDatabase(), MISSING_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
