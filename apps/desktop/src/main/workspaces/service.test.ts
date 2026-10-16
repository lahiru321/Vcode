import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { terminalSessions, workspaces } from '../db/schema';
import { createProject, updateProject } from '../projects/service';
import { tempDir, testDatabase } from '../testing';
import { createWorkspace, deleteWorkspace, listWorkspaces } from './service';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function setup() {
  const db = testDatabase();
  const root = join(tempDir(), 'shop');
  mkdirSync(root);
  const project = await createProject(db, { rootPath: root });
  return { db, root, project };
}

describe('listWorkspaces', () => {
  it("creates the project's main workspace on first use", async () => {
    const { db, project } = await setup();
    const list = await listWorkspaces(db, project.id);
    expect(list).toEqual([
      expect.objectContaining({ name: 'main', kind: 'main', path: project.rootPath }),
    ]);
    expect(await listWorkspaces(db, project.id)).toEqual(list);
  });

  it('lists main first, then the others by name, for that project only', async () => {
    const { db, project } = await setup();
    const other = await createProject(db, { rootPath: tempDir() });
    for (const name of ['zeta', 'Beta', 'alpha']) {
      await createWorkspace(db, { projectId: project.id, name, kind: 'folder' });
    }
    await listWorkspaces(db, other.id);

    expect((await listWorkspaces(db, project.id)).map((w) => w.name)).toEqual([
      'main',
      'alpha',
      'Beta',
      'zeta',
    ]);
    expect((await listWorkspaces(db, other.id)).map((w) => w.name)).toEqual(['main']);
  });

  it('marks a folder that is gone as missing, and one that now links out as error', async () => {
    const { db, project } = await setup();
    const gone = await createWorkspace(db, { projectId: project.id, name: 'gone', kind: 'folder' });
    const swapped = await createWorkspace(db, {
      projectId: project.id,
      name: 'swapped',
      kind: 'folder',
    });
    rmSync(gone.path, { recursive: true });
    rmSync(swapped.path, { recursive: true });
    symlinkSync(tempDir(), swapped.path, 'junction');

    const byName = Object.fromEntries(
      (await listWorkspaces(db, project.id)).map((w) => [w.name, w.status]),
    );
    expect(byName).toEqual({ main: 'ready', gone: 'missing', swapped: 'error' });
    // Saved, and back to ready once the folder is.
    expect(db.select().from(workspaces).where(eq(workspaces.id, gone.id)).get()?.status).toBe(
      'missing',
    );
    mkdirSync(gone.path);
    expect((await listWorkspaces(db, project.id)).find((w) => w.id === gone.id)?.status).toBe(
      'ready',
    );
  });

  it('fails for an unknown project', async () => {
    await expect(listWorkspaces(testDatabase(), MISSING_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('createWorkspace', () => {
  it('makes a new folder under workspaces/, named after the workspace', async () => {
    const { db, root, project } = await setup();
    const workspace = await createWorkspace(db, {
      projectId: project.id,
      name: 'Claude Backend',
      kind: 'folder',
    });
    expect(workspace).toMatchObject({
      projectId: project.id,
      name: 'Claude Backend',
      kind: 'folder',
      path: join(root, 'workspaces', 'claude-backend'),
      branch: null,
      status: 'ready',
    });
    expect(existsSync(workspace.path)).toBe(true);
  });

  it('reuses a folder left behind by a deleted workspace of the same name', async () => {
    const { db, project } = await setup();
    const first = await createWorkspace(db, { projectId: project.id, name: 'qa', kind: 'folder' });
    writeFileSync(join(first.path, 'notes.txt'), 'kept');
    deleteWorkspace(db, first.id);
    expect(existsSync(join(first.path, 'notes.txt'))).toBe(true);

    const again = await createWorkspace(db, { projectId: project.id, name: 'qa', kind: 'folder' });
    expect(again.path).toBe(first.path);
  });

  it('uses an existing folder inside the project, absolute or relative', async () => {
    const { db, root, project } = await setup();
    mkdirSync(join(root, 'backend', 'api'), { recursive: true });
    const a = await createWorkspace(db, {
      projectId: project.id,
      name: 'Backend',
      kind: 'folder',
      path: join(root, 'backend'),
    });
    const b = await createWorkspace(db, {
      projectId: project.id,
      name: 'API',
      kind: 'folder',
      path: join('backend', 'api'),
    });
    expect([a.path, b.path]).toEqual([join(root, 'backend'), join(root, 'backend', 'api')]);
  });

  it('refuses a folder outside the project, through .. or a link, and the root itself', async () => {
    const { db, root, project } = await setup();
    const outside = tempDir();
    symlinkSync(outside, join(root, 'escape'), 'junction');
    const create = (path: string) =>
      createWorkspace(db, { projectId: project.id, name: 'x', kind: 'folder', path });

    for (const path of [outside, join('..', '..'), join(root, 'escape')]) {
      await expect(create(path)).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
        message: expect.stringContaining('inside the project folder'),
      });
    }
    await expect(create(root)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('main workspace'),
    });
    await expect(create('.')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('refuses a new folder when workspaces/ links outside the project', async () => {
    const { db, root, project } = await setup();
    const outside = tempDir();
    symlinkSync(outside, join(root, 'workspaces'), 'junction');
    await expect(
      createWorkspace(db, { projectId: project.id, name: 'qa', kind: 'folder' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(existsSync(join(outside, 'qa'))).toBe(false);
  });

  it('refuses a taken name (any case, main included) or folder', async () => {
    const { db, root, project } = await setup();
    mkdirSync(join(root, 'web'));
    await createWorkspace(db, { projectId: project.id, name: 'Web', kind: 'folder', path: 'web' });
    for (const request of [
      { name: 'web' },
      { name: 'MAIN' },
      { name: 'Other', path: join(root, 'web') },
    ]) {
      await expect(
        createWorkspace(db, { projectId: project.id, kind: 'folder', ...request }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }
  });

  it('refuses archived and unknown projects', async () => {
    const { db, project } = await setup();
    updateProject(db, { id: project.id, status: 'archived' });
    await expect(
      createWorkspace(db, { projectId: project.id, name: 'a', kind: 'folder' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      createWorkspace(db, { projectId: MISSING_ID, name: 'a', kind: 'folder' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('deleteWorkspace', () => {
  it('removes the record and its ended terminals, but never files', async () => {
    const { db, project } = await setup();
    const workspace = await createWorkspace(db, {
      projectId: project.id,
      name: 'qa',
      kind: 'folder',
    });
    db.insert(terminalSessions)
      .values({
        workspaceId: workspace.id,
        title: 'old',
        shell: 'pwsh',
        cwd: workspace.path,
        cols: 80,
        rows: 24,
        status: 'exited',
      })
      .run();

    expect(await deleteWorkspace(db, workspace.id)).toEqual({
      id: workspace.id,
      removedFolder: false,
    });
    expect((await listWorkspaces(db, project.id)).map((w) => w.name)).toEqual(['main']);
    expect(db.select().from(terminalSessions).all()).toEqual([]);
    expect(existsSync(workspace.path)).toBe(true);
  });

  it('refuses main, a workspace with a running terminal, and unknown ids', async () => {
    const { db, project } = await setup();
    const [main] = await listWorkspaces(db, project.id);
    const workspace = await createWorkspace(db, {
      projectId: project.id,
      name: 'qa',
      kind: 'folder',
    });
    db.insert(terminalSessions)
      .values({
        workspaceId: workspace.id,
        title: 'live',
        shell: 'pwsh',
        cwd: workspace.path,
        cols: 80,
        rows: 24,
        status: 'running',
      })
      .run();

    await expect(deleteWorkspace(db, main!.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(deleteWorkspace(db, workspace.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('running'),
    });
    await expect(deleteWorkspace(db, MISSING_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
