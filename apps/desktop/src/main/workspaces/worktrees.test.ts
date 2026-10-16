import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { terminalSessions } from '../db/schema';
import { createProject } from '../projects/service';
import { tempDir, testDatabase } from '../testing';
import { createWorkspace, deleteWorkspace, getWorkspaceChanges, listWorkspaces } from './service';

// Worktree workspaces (P6-04), against a real git repository in a temp folder.

function gitSync(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A repository on `main` with one commit, as a project. */
async function setup() {
  const db = testDatabase();
  const root = join(tempDir(), 'shop');
  mkdirSync(root);
  gitSync(root, 'init', '--quiet', '--initial-branch=main');
  gitSync(root, 'config', 'user.email', 'test@example.com');
  gitSync(root, 'config', 'user.name', 'Test');
  gitSync(root, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(root, 'README.md'), 'hello\n');
  gitSync(root, 'add', '.');
  gitSync(root, 'commit', '--quiet', '-m', 'first');
  const project = await createProject(db, { rootPath: root });
  return { db, root, project };
}

function worktreeFolders(root: string): string[] {
  return gitSync(root, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

describe('worktree workspaces', () => {
  it('checks out a new branch in workspaces/<name>, hidden from the main folder', async () => {
    const { db, root, project } = await setup();
    const workspace = await createWorkspace(db, {
      projectId: project.id,
      name: 'Claude Backend',
      kind: 'worktree',
      branch: 'feature/backend',
    });

    expect(workspace).toMatchObject({
      kind: 'worktree',
      branch: 'feature/backend',
      path: join(root, 'workspaces', 'claude-backend'),
      status: 'ready',
    });
    expect(readFileSync(join(workspace.path, 'README.md'), 'utf8')).toBe('hello\n');
    expect(gitSync(workspace.path, 'branch', '--show-current').trim()).toBe('feature/backend');
    // workspaces/ is excluded locally, so the main folder stays clean.
    expect(gitSync(root, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8')).toContain('/workspaces/');
  });

  it('checks out an existing branch as it is, and starts a new one where asked', async () => {
    const { db, root, project } = await setup();
    gitSync(root, 'branch', 'existing');
    writeFileSync(join(root, 'second.txt'), '2\n');
    gitSync(root, 'add', '.');
    gitSync(root, 'commit', '--quiet', '-m', 'second');

    const existing = await createWorkspace(db, {
      projectId: project.id,
      name: 'old',
      kind: 'worktree',
      branch: 'existing',
    });
    expect(existsSync(join(existing.path, 'second.txt'))).toBe(false);

    const fromExisting = await createWorkspace(db, {
      projectId: project.id,
      name: 'new',
      kind: 'worktree',
      branch: 'fresh',
      startPoint: 'existing',
    });
    expect(existsSync(join(fromExisting.path, 'second.txt'))).toBe(false);
    expect(gitSync(fromExisting.path, 'branch', '--show-current').trim()).toBe('fresh');
  });

  it("never runs the repository's hooks", async () => {
    const { db, root, project } = await setup();
    const hook = join(root, '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, '#!/bin/sh\necho ran > hook-ran\n', { mode: 0o755 });

    // The hook works when git is run directly…
    const direct = join(tempDir(), 'direct');
    gitSync(root, 'worktree', 'add', '--quiet', '-b', 'direct', direct);
    expect(existsSync(join(direct, 'hook-ran'))).toBe(true);

    // …but not through Vcode.
    const workspace = await createWorkspace(db, {
      projectId: project.id,
      name: 'agent',
      kind: 'worktree',
      branch: 'agent',
    });
    expect(existsSync(join(workspace.path, 'hook-ran'))).toBe(false);
  });

  it('refuses a plain folder, a bad branch name, a branch checked out elsewhere, a used folder', async () => {
    const { db, root, project } = await setup();
    const plain = await createProject(db, { rootPath: tempDir() });
    await expect(
      createWorkspace(db, { projectId: plain.id, name: 'x', kind: 'worktree', branch: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: /isn’t a Git repository/ });

    await expect(
      createWorkspace(db, { projectId: project.id, name: 'x', kind: 'worktree', branch: 'a..b' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: /valid branch name/ });

    await expect(
      createWorkspace(db, { projectId: project.id, name: 'x', kind: 'worktree', branch: 'main' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: /^Git: / });

    mkdirSync(join(root, 'workspaces', 'taken'), { recursive: true });
    await expect(
      createWorkspace(db, { projectId: project.id, name: 'taken', kind: 'worktree', branch: 't' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: /already exists/ });

    expect((await listWorkspaces(db, project.id)).map((w) => w.name)).toEqual(['main']);
    expect(worktreeFolders(root)).toHaveLength(1);
  });

  it('shows the branch checked out in the worktree now', async () => {
    const { db, project } = await setup();
    const workspace = await createWorkspace(db, {
      projectId: project.id,
      name: 'agent',
      kind: 'worktree',
      branch: 'agent',
    });
    gitSync(workspace.path, 'switch', '--quiet', '-c', 'agent-2');
    expect((await listWorkspaces(db, project.id)).find((w) => w.id === workspace.id)?.branch).toBe(
      'agent-2',
    );
  });

  it('shows the project branch on main and folder workspaces (P6-06)', async () => {
    const { db, root, project } = await setup();
    await createWorkspace(db, { projectId: project.id, name: 'docs', kind: 'folder' });
    gitSync(root, 'switch', '--quiet', '-c', 'next');
    const branches = (await listWorkspaces(db, project.id)).map((w) => [w.name, w.branch]);
    expect(branches).toEqual([
      ['main', 'next'],
      ['docs', 'next'],
    ]);
  });

  it('counts changes per workspace: whole project, inside a folder, in a worktree (P6-06)', async () => {
    const { db, root, project } = await setup();
    mkdirSync(join(root, 'backend'));
    writeFileSync(join(root, 'backend', 'app.ts'), 'x\n');
    gitSync(root, 'add', '.');
    gitSync(root, 'commit', '--quiet', '-m', 'backend');
    const [main] = await listWorkspaces(db, project.id);
    const backend = await createWorkspace(db, {
      projectId: project.id,
      name: 'backend',
      kind: 'folder',
      path: 'backend',
    });
    const tree = await createWorkspace(db, {
      projectId: project.id,
      name: 'agent',
      kind: 'worktree',
      branch: 'agent',
    });

    expect(await getWorkspaceChanges(db, backend.id)).toEqual({ count: 0, files: [] });
    writeFileSync(join(root, 'README.md'), 'changed\n');
    writeFileSync(join(root, 'backend', 'app.ts'), 'y\n');
    writeFileSync(join(tree.path, 'new.txt'), 'new\n');

    expect(await getWorkspaceChanges(db, main!.id)).toEqual({
      count: 2,
      files: [' M README.md', ' M backend/app.ts'],
    });
    expect(await getWorkspaceChanges(db, backend.id)).toEqual({
      count: 1,
      files: [' M backend/app.ts'],
    });
    expect(await getWorkspaceChanges(db, tree.id)).toEqual({ count: 1, files: ['?? new.txt'] });
  });

  it('has no changes to report for a plain folder, a missing folder or a broken worktree', async () => {
    const { db, project } = await setup();
    const plain = await createProject(db, { rootPath: tempDir() });
    const [plainMain] = await listWorkspaces(db, plain.id);
    const gone = await createWorkspace(db, { projectId: project.id, name: 'gone', kind: 'folder' });
    const broken = await createWorkspace(db, {
      projectId: project.id,
      name: 'broken',
      kind: 'worktree',
      branch: 'broken',
    });
    rmSync(gone.path, { recursive: true });
    // Without its .git file, git would report the project's changes from inside it.
    rmSync(join(broken.path, '.git'));

    expect(await getWorkspaceChanges(db, plainMain!.id)).toBeNull();
    expect(await getWorkspaceChanges(db, gone.id)).toBeNull();
    expect(await getWorkspaceChanges(db, broken.id)).toBeNull();
  });

  it('removes a clean worktree with its folder; the branch stays', async () => {
    const { db, root, project } = await setup();
    const workspace = await createWorkspace(db, {
      projectId: project.id,
      name: 'agent',
      kind: 'worktree',
      branch: 'agent',
    });

    expect(await getWorkspaceChanges(db, workspace.id)).toEqual({ count: 0, files: [] });
    expect(await deleteWorkspace(db, workspace.id)).toEqual({
      id: workspace.id,
      removedFolder: true,
    });
    expect(existsSync(workspace.path)).toBe(false);
    expect(worktreeFolders(root)).toHaveLength(1);
    expect(gitSync(root, 'branch', '--list', 'agent').trim()).toBe('agent');
    expect((await listWorkspaces(db, project.id)).map((w) => w.name)).toEqual(['main']);
  });

  it('refuses a worktree with uncommitted changes unless forced', async () => {
    const { db, root, project } = await setup();
    const workspace = await createWorkspace(db, {
      projectId: project.id,
      name: 'agent',
      kind: 'worktree',
      branch: 'agent',
    });
    writeFileSync(join(workspace.path, 'README.md'), 'changed\n');
    writeFileSync(join(workspace.path, 'new.txt'), 'new\n');

    expect(await getWorkspaceChanges(db, workspace.id)).toEqual({
      count: 2,
      files: [' M README.md', '?? new.txt'],
    });
    await expect(deleteWorkspace(db, workspace.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      message:
        '“agent” has 2 uncommitted changes. Commit or discard them first, or delete it anyway.',
    });
    expect(existsSync(workspace.path)).toBe(true);

    expect(await deleteWorkspace(db, workspace.id, true)).toMatchObject({ removedFolder: true });
    expect(existsSync(workspace.path)).toBe(false);
    expect(worktreeFolders(root)).toHaveLength(1);
  });

  it('prunes a worktree whose folder is gone, and refuses while a terminal runs', async () => {
    const { db, root, project } = await setup();
    const gone = await createWorkspace(db, {
      projectId: project.id,
      name: 'gone',
      kind: 'worktree',
      branch: 'gone',
    });
    const busy = await createWorkspace(db, {
      projectId: project.id,
      name: 'busy',
      kind: 'worktree',
      branch: 'busy',
    });
    db.insert(terminalSessions)
      .values({
        workspaceId: busy.id,
        title: 'live',
        shell: 'pwsh',
        cwd: busy.path,
        cols: 80,
        rows: 24,
        status: 'running',
      })
      .run();

    rmSync(gone.path, { recursive: true, force: true });
    expect(await deleteWorkspace(db, gone.id)).toMatchObject({ removedFolder: false });
    expect(worktreeFolders(root)).toEqual([expect.any(String), expect.stringMatching(/busy$/)]);

    await expect(deleteWorkspace(db, busy.id, true)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('running'),
    });
    expect(existsSync(busy.path)).toBe(true);
  });
});
