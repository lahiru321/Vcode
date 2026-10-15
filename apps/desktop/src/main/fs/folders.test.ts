import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../testing';
import {
  isInsideFolder,
  planWorkspaceFolder,
  resolveExistingFolder,
  resolveWorkspaceFolder,
} from './folders';

describe('resolveExistingFolder', () => {
  it('returns an existing folder', async () => {
    const dir = tempDir();
    await expect(resolveExistingFolder(dir)).resolves.toBe(dir);
  });

  it('resolves "." and ".." segments', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'a'));
    await expect(resolveExistingFolder(join(dir, 'a', '..', 'a', '.'))).resolves.toBe(
      join(dir, 'a'),
    );
  });

  it('follows links, so one folder always gives the same path', async () => {
    const dir = tempDir();
    const target = join(dir, 'target');
    mkdirSync(target);
    // A junction on Windows (no admin rights needed); a directory symlink elsewhere.
    symlinkSync(target, join(dir, 'link'), 'junction');
    await expect(resolveExistingFolder(join(dir, 'link'))).resolves.toBe(target);
  });

  it('refuses relative paths', async () => {
    await expect(resolveExistingFolder('some/folder')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('full folder path'),
    });
  });

  it('refuses a missing folder', async () => {
    const missing = join(tempDir(), 'nope');
    await expect(resolveExistingFolder(missing)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: `Folder not found: ${missing}`,
    });
  });

  it('refuses a file', async () => {
    const file = join(tempDir(), 'file.txt');
    writeFileSync(file, '');
    await expect(resolveExistingFolder(file)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: `Not a folder: ${file}`,
    });
  });

  it('refuses a drive or filesystem root', async () => {
    await expect(resolveExistingFolder(parse(tempDir()).root)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('whole drive'),
    });
  });
});

describe('isInsideFolder', () => {
  const root = join(parse(process.cwd()).root, 'work', 'shop');
  it.each([
    [root, true],
    [join(root, 'a'), true],
    [join(root, 'a', 'b'), true],
    [join(root, '..dotdot-name'), true],
    [join(root, '..'), false],
    [join(root, '..', 'shop-2'), false],
    [`${root}-2`, false],
    [join(parse(root).root, 'elsewhere'), false],
  ])('%s → %s', (path, inside) => {
    expect(isInsideFolder(root, path)).toBe(inside);
  });
});

const OUTSIDE = { code: 'INVALID_REQUEST', message: expect.stringContaining('inside the project') };

/** A project root with a `ws` folder inside, and a folder `outside` next to it. */
function layout() {
  const base = tempDir();
  const root = join(base, 'project');
  const outside = join(base, 'outside');
  mkdirSync(join(root, 'ws'), { recursive: true });
  mkdirSync(outside);
  return { base, root, outside };
}

describe('resolveWorkspaceFolder', () => {
  it('accepts the root and folders inside it, absolute or relative', async () => {
    const { root } = layout();
    await expect(resolveWorkspaceFolder(root, root)).resolves.toBe(root);
    await expect(resolveWorkspaceFolder(root, join(root, 'ws'))).resolves.toBe(join(root, 'ws'));
    await expect(resolveWorkspaceFolder(root, 'ws')).resolves.toBe(join(root, 'ws'));
  });

  it('refuses folders outside the root, by path or by ..', async () => {
    const { root, outside } = layout();
    await expect(resolveWorkspaceFolder(root, outside)).rejects.toMatchObject(OUTSIDE);
    await expect(
      resolveWorkspaceFolder(root, join('ws', '..', '..', 'outside')),
    ).rejects.toMatchObject(OUTSIDE);
    await expect(resolveWorkspaceFolder(root, `${root}-2`)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('refuses a link inside the root that points outside it', async () => {
    const { root, outside } = layout();
    symlinkSync(outside, join(root, 'escape'), 'junction');
    await expect(resolveWorkspaceFolder(root, join(root, 'escape'))).rejects.toMatchObject(OUTSIDE);
  });

  it('accepts a link inside the root that points inside it, as its real path', async () => {
    const { root } = layout();
    symlinkSync(join(root, 'ws'), join(root, 'alias'), 'junction');
    await expect(resolveWorkspaceFolder(root, join(root, 'alias'))).resolves.toBe(join(root, 'ws'));
  });

  it('follows a project root that is itself reached through a link', async () => {
    const { base, root } = layout();
    symlinkSync(root, join(base, 'root-link'), 'junction');
    await expect(resolveWorkspaceFolder(join(base, 'root-link'), 'ws')).resolves.toBe(
      join(root, 'ws'),
    );
  });

  it('refuses a missing folder or project root', async () => {
    const { base, root } = layout();
    await expect(resolveWorkspaceFolder(root, 'nope')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('Folder not found'),
    });
    await expect(resolveWorkspaceFolder(join(base, 'gone'), 'ws')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('project folder is missing'),
    });
  });
});

describe('planWorkspaceFolder', () => {
  it('plans a new folder inside the root, under existing real folders', async () => {
    const { root } = layout();
    await expect(planWorkspaceFolder(root, join('workspaces', 'claude-a'))).resolves.toBe(
      join(root, 'workspaces', 'claude-a'),
    );
    await expect(planWorkspaceFolder(root, join(root, 'ws', 'sub'))).resolves.toBe(
      join(root, 'ws', 'sub'),
    );
    await expect(planWorkspaceFolder(root, 'ws')).resolves.toBe(join(root, 'ws'));
  });

  it('refuses the root itself and anything outside it', async () => {
    const { root, outside } = layout();
    await expect(planWorkspaceFolder(root, root)).rejects.toMatchObject(OUTSIDE);
    await expect(planWorkspaceFolder(root, '.')).rejects.toMatchObject(OUTSIDE);
    await expect(planWorkspaceFolder(root, join(outside, 'new'))).rejects.toMatchObject(OUTSIDE);
    await expect(planWorkspaceFolder(root, join('..', 'sibling'))).rejects.toMatchObject(OUTSIDE);
  });

  it('refuses a new folder under a link that points outside the root', async () => {
    const { root, outside } = layout();
    symlinkSync(outside, join(root, 'workspaces'), 'junction');
    await expect(planWorkspaceFolder(root, join('workspaces', 'claude-a'))).rejects.toMatchObject(
      OUTSIDE,
    );
  });
});
