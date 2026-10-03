import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../testing';
import { resolveExistingFolder } from './folders';

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
