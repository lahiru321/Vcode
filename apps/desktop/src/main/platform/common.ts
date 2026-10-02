import { execFile } from 'node:child_process';
import type { Environment } from './types';

export function toEnvironment(env: NodeJS.ProcessEnv): Environment {
  const result: Environment = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}

export function assertPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid process id: ${pid}`);
  }
}

export interface RunResult {
  /** Exit code, or null if the process was killed (e.g. by the timeout). */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a short-lived helper process and collects its output. Never rejects for a non-zero exit. */
export function run(
  file: string,
  args: string[],
  options: { timeoutMs: number; env?: Environment },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        env: options.env,
        timeout: options.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number' && !error.killed) {
          // Could not start at all (ENOENT, EACCES, …).
          reject(error);
          return;
        }
        const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}
