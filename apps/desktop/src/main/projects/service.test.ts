import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir, testDatabase } from '../testing';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  slugify,
  updateProject,
} from './service';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

/** A new folder called `name` inside a temp folder. */
function folder(name: string): string {
  const dir = join(tempDir(), name);
  mkdirSync(dir);
  return dir;
}

describe('slugify', () => {
  it.each([
    ['My Shop (v2)', 'my-shop-v2'],
    ['  Café  Crème ', 'cafe-creme'],
    ['___', 'project'],
    ['日本語', 'project'],
    ['a'.repeat(60), 'a'.repeat(48)],
    ['Already-a-slug', 'already-a-slug'],
  ])('%s → %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});

describe('createProject', () => {
  it('names the project after its folder by default', async () => {
    const db = testDatabase();
    const dir = folder('My App');
    const project = await createProject(db, { rootPath: dir });
    expect(project).toMatchObject({
      name: 'My App',
      slug: 'my-app',
      rootPath: dir,
      defaultBranch: null,
      status: 'active',
    });
  });

  it('uses the given name', async () => {
    const db = testDatabase();
    const project = await createProject(db, { rootPath: folder('x'), name: 'Backend' });
    expect(project.name).toBe('Backend');
  });

  it('records the Git default branch', async () => {
    const db = testDatabase();
    const dir = folder('repo');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    expect((await createProject(db, { rootPath: dir })).defaultBranch).toBe('main');
  });

  it('makes slugs unique', async () => {
    const db = testDatabase();
    const slugs = [];
    for (let i = 0; i < 3; i++) {
      slugs.push((await createProject(db, { rootPath: folder('x'), name: 'Shop' })).slug);
    }
    expect(slugs).toEqual(['shop', 'shop-2', 'shop-3']);
  });

  it('refuses a folder that is already a project, also through a link', async () => {
    const db = testDatabase();
    const dir = folder('app');
    await createProject(db, { rootPath: dir, name: 'First' });

    const conflict = { code: 'CONFLICT', message: 'This folder is already the project “First”.' };
    await expect(createProject(db, { rootPath: dir })).rejects.toMatchObject(conflict);

    const link = join(tempDir(), 'link');
    symlinkSync(dir, link, 'junction');
    await expect(createProject(db, { rootPath: link })).rejects.toMatchObject(conflict);
    expect(listProjects(db)).toHaveLength(1);
  });

  it('refuses invalid folders', async () => {
    const db = testDatabase();
    await expect(createProject(db, { rootPath: 'relative' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(createProject(db, { rootPath: join(tempDir(), 'missing') })).rejects.toMatchObject(
      { code: 'INVALID_REQUEST' },
    );
  });
});

describe('listProjects', () => {
  it('sorts by name, ignoring case', async () => {
    const db = testDatabase();
    for (const name of ['beta', 'Alpha', 'gamma', 'Beta']) {
      await createProject(db, { rootPath: folder('x'), name });
    }
    // Equal names keep their creation order.
    expect(listProjects(db).map((p) => p.name)).toEqual(['Alpha', 'beta', 'Beta', 'gamma']);
  });
});

describe('getProject / updateProject / deleteProject', () => {
  it('renames and archives without touching the folder or slug', async () => {
    const db = testDatabase();
    const created = await createProject(db, { rootPath: folder('x'), name: 'Old' });

    const renamed = updateProject(db, { id: created.id, name: 'New' });
    expect(renamed).toMatchObject({ name: 'New', slug: 'old', rootPath: created.rootPath });

    const archived = updateProject(db, { id: created.id, status: 'archived' });
    expect(archived.status).toBe('archived');
    expect(getProject(db, created.id)).toEqual(archived);
  });

  it('deletes the record but not the folder', async () => {
    const db = testDatabase();
    const dir = folder('keep-me');
    const { id } = await createProject(db, { rootPath: dir });
    expect(deleteProject(db, id)).toEqual({ id });
    expect(listProjects(db)).toEqual([]);
    // The folder can be added again, so it's still there.
    await expect(createProject(db, { rootPath: dir })).resolves.toMatchObject({ rootPath: dir });
  });

  it('reports a missing project as NOT_FOUND', () => {
    const db = testDatabase();
    const notFound = { code: 'NOT_FOUND' };
    expect(() => getProject(db, MISSING_ID)).toThrow(expect.objectContaining(notFound));
    expect(() => updateProject(db, { id: MISSING_ID, name: 'x' })).toThrow(
      expect.objectContaining(notFound),
    );
    expect(() => deleteProject(db, MISSING_ID)).toThrow(expect.objectContaining(notFound));
  });
});
