import { spawn } from 'node:child_process';
import { IpcError } from '@vcode/shared';
import { platform, type Environment, type Executable } from '../platform';
import { loadBaseEnvironment } from '../terminals/environment';

// "Open in VS Code" (P6-07): runs VS Code's `code` command with the folder and lets it go. The
// folder comes from a workspace record and has passed the path guards; the renderer never names
// a path here.

/** `code` on the user's PATH, else in VS Code's default install folders; null if not found. */
export async function findVsCode(env: Environment): Promise<Executable | null> {
  for (const candidate of ['code', ...platform.vsCodeLocations(env)]) {
    const executable = await platform.resolveExecutable(candidate, env);
    if (executable) {
      return executable;
    }
  }
  return null;
}

/** Opens `folder` in VS Code (a new window, or the one that already has it open). */
export async function openInVsCode(folder: string): Promise<void> {
  const env = await loadBaseEnvironment();
  const executable = await findVsCode(env);
  if (!executable) {
    throw new IpcError(
      'UNAVAILABLE',
      'VS Code was not found. Install it, or add its “code” command to PATH.',
    );
  }
  const command = platform.buildCommand(executable, [folder], env);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: command.verbatimArguments,
    });
    child.once('error', (err) =>
      reject(new IpcError('UNAVAILABLE', `VS Code could not be started: ${err.message}`)),
    );
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
