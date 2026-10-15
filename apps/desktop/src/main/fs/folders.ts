import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { IpcError } from '@vcode/shared';

/**
 * Resolves a folder chosen by the user to its real path: symlinks and junctions are followed,
 * and on Windows the casing matches the disk, so one folder always gives the same string.
 * Throws IpcError('INVALID_REQUEST') with a message fit for the UI. Spec: V1 doc §17, §21.
 */
export async function resolveExistingFolder(input: string): Promise<string> {
  if (!isAbsolute(input)) {
    throw new IpcError('INVALID_REQUEST', 'Choose a full folder path, not a relative one.');
  }

  let resolved: string;
  try {
    // fs/promises realpath has fs.realpath.native semantics (true casing, junctions resolved).
    resolved = await realpath(input);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new IpcError(
      'INVALID_REQUEST',
      code === 'ENOENT' || code === 'ENOTDIR'
        ? `Folder not found: ${input}`
        : `Can't open folder ${input} (${code ?? 'unknown error'}).`,
    );
  }

  if (!(await stat(resolved)).isDirectory()) {
    throw new IpcError('INVALID_REQUEST', `Not a folder: ${input}`);
  }
  if (dirname(resolved) === resolved) {
    throw new IpcError('INVALID_REQUEST', 'A whole drive can’t be a project. Choose a folder.');
  }
  return resolved;
}

// Workspace path guards (V1 doc §17, §21; P6-05): every workspace folder must resolve inside its
// project's root. Both sides are compared as real paths, so a symlink or junction anywhere on
// the way can't point a workspace — or a terminal started in one — outside the project.

/** True if `path` is `root` or inside it. Both must already be real, absolute paths. */
export function isInsideFolder(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function outsideProject(input: string): IpcError {
  return new IpcError('INVALID_REQUEST', `Workspaces must be inside the project folder: ${input}`);
}

/** The project root's real path; INVALID_REQUEST if it is gone. */
async function realRoot(projectRoot: string): Promise<string> {
  try {
    return await realpath(projectRoot);
  } catch {
    throw new IpcError('INVALID_REQUEST', `The project folder is missing: ${projectRoot}`);
  }
}

/**
 * An existing workspace folder, resolved like resolveExistingFolder (a relative `input` is taken
 * from the project root), that must be the project root or inside it once every link on the way
 * is followed. Returns the real path. Run it again before each use: a folder can be replaced by
 * a link after it was checked.
 */
export async function resolveWorkspaceFolder(projectRoot: string, input: string): Promise<string> {
  const root = await realRoot(projectRoot);
  const folder = await resolveExistingFolder(resolve(root, input));
  if (!isInsideFolder(root, folder)) {
    throw outsideProject(input);
  }
  return folder;
}

/**
 * Where a new workspace folder will go (it may not exist yet): `input` (relative to the project
 * root, or absolute) with its deepest existing ancestor resolved to a real path and the rest
 * appended. Must end up strictly inside the project root. Returns that path; nothing is created.
 */
export async function planWorkspaceFolder(projectRoot: string, input: string): Promise<string> {
  const root = await realRoot(projectRoot);
  const target = resolve(root, input);
  const missing: string[] = [];
  let existing = target;
  let real: string | null = null;
  while (real === null) {
    try {
      real = await realpath(existing);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = dirname(existing);
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || parent === existing) {
        throw new IpcError('INVALID_REQUEST', `Can't use folder ${input} (${code ?? 'error'}).`);
      }
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
  const planned = missing.length > 0 ? join(real, ...missing) : real;
  if (planned === root || !isInsideFolder(root, planned)) {
    throw outsideProject(input);
  }
  return planned;
}
