import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
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
