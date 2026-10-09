import { execFile } from 'node:child_process';
import type { AdapterContext, RunCommand } from '@vcode/adapters';
import { platform } from '../platform';

/** Output beyond this is cut off; version checks print a line or two. */
const MAX_OUTPUT = 64 * 1024;

/**
 * Runs a command to completion without a terminal (e.g. `claude --version`). Never throws: a
 * command that can't start comes back with `exitCode: null` and the error in `stderr`.
 */
export const runCommand: RunCommand = (command, { env, timeoutMs }) =>
  new Promise((resolve) => {
    execFile(
      command.file,
      command.args,
      {
        env,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
        windowsVerbatimArguments: command.verbatimArguments,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stdout, stderr, timedOut: false });
          return;
        }
        const { code, killed, signal } = error as NodeJS.ErrnoException & {
          killed?: boolean;
          signal?: string | null;
        };
        const timedOut = killed === true && signal != null;
        resolve({
          exitCode: typeof code === 'number' ? code : null,
          stdout,
          stderr: stderr || (typeof code === 'number' || timedOut ? '' : error.message),
          timedOut,
        });
      },
    );
  });

/** What adapters get from the main process. */
export const adapterContext: AdapterContext = { platform, run: runCommand };
