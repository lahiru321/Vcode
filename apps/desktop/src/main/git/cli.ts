import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { IpcError } from '@vcode/shared';
import { platform, toEnvironment, type Environment, type Executable } from '../platform';

// Runs `git` for the operations that can't be done by reading files (worktrees, status). Hooks
// are always off: nothing a repository supplies is executed (the P1-11 rule), so `core.hooksPath`
// points below the app's own executable, a path where no folder can ever exist. fsmonitor is off
// too, so no daemon is started and left behind.

const SAFE_CONFIG = [
  '-c',
  `core.hooksPath=${join(process.execPath, 'no-hooks')}`,
  '-c',
  'core.fsmonitor=false',
];

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 16 * 1024 * 1024;

export interface GitResult {
  /** Exit code, or null if git was killed (e.g. by the timeout). */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The app's environment without `GIT_*` variables (GIT_DIR etc. would redirect every command). */
function gitEnvironment(): Environment {
  const env = toEnvironment(process.env);
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith('GIT_')) {
      delete env[name];
    }
  }
  env['GIT_TERMINAL_PROMPT'] = '0';
  return env;
}

let found: Promise<{ executable: Executable; env: Environment } | null> | null = null;

/** git on PATH, looked up once it's been found (and again each time until then). */
async function findGit() {
  found ??= (async () => {
    const env = gitEnvironment();
    const executable = await platform.resolveExecutable('git', env);
    return executable ? { executable, env } : null;
  })();
  const result = await found;
  if (!result) {
    found = null;
  }
  return result;
}

/**
 * Runs `git <args>` in `cwd`. Never rejects for a non-zero exit; UNAVAILABLE if git isn't
 * installed (or can't be started).
 */
export async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<GitResult> {
  const git = await findGit();
  if (!git) {
    throw new IpcError(
      'UNAVAILABLE',
      'Git was not found. Install Git (and make sure it is on PATH) to use worktree workspaces.',
    );
  }
  const { executable, env } = git;
  const command = platform.buildCommand(executable, [...SAFE_CONFIG, ...args], env);
  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      {
        cwd,
        env,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
        windowsVerbatimArguments: command.verbatimArguments,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number' && !error.killed) {
          reject(new IpcError('UNAVAILABLE', `Git could not be started: ${error.message}`));
          return;
        }
        const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/** git's own explanation of a failure: its `fatal:` / `error:` line, else the last line. */
export function gitErrorMessage(result: GitResult): string {
  if (result.code === null) {
    return 'Git took too long and was stopped.';
  }
  const lines = result.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const reason = lines.find((line) => /^(fatal|error):/i.test(line)) ?? lines.at(-1);
  return reason
    ? reason.replace(/^(fatal|error):\s*/i, '')
    : `Git failed (exit code ${result.code}).`;
}

/** `runGit`, throwing an IpcError with git's message (CONFLICT by default) on a non-zero exit. */
export async function git(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; code?: IpcError['code'] } = {},
): Promise<string> {
  const result = await runGit(cwd, args, options.timeoutMs);
  if (result.code !== 0) {
    throw new IpcError(options.code ?? 'CONFLICT', `Git: ${gitErrorMessage(result)}`);
  }
  return result.stdout;
}
