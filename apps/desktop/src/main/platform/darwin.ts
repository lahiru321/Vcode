import { spawn } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, normalize } from 'node:path';
import { userInfo } from 'node:os';
import { shell } from 'electron';
import { assertPid, run, toEnvironment } from './common';
import type { Command, Environment, Executable, Platform, ProcessInfo } from './types';

// macOS support ships after V1 (ROADMAP "macOS Release"). This module is complete enough to
// load and to unit-test on macOS CI, but has not been run against a real macOS desktop yet.

const KILL_GRACE_MS = 3_000;
const ENV_TIMEOUT_MS = 10_000;
const ENV_MARKER = '__VCODE_ENV__';

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) {
      return false;
    }
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(command: string, env: Environment): Promise<Executable | null> {
  const name = command.trim();
  if (name.length === 0) {
    return null;
  }
  if (isAbsolute(name)) {
    const path = normalize(name);
    return (await isExecutableFile(path)) ? { path, kind: 'binary' } : null;
  }
  if (name.includes('/')) {
    return null;
  }

  for (const dir of (env['PATH'] ?? '').split(':')) {
    if (!isAbsolute(dir)) {
      continue;
    }
    const path = join(dir, name);
    if (await isExecutableFile(path)) {
      return { path, kind: 'binary' };
    }
  }
  return null;
}

function buildCommand(executable: Executable, args: string[]): Command {
  return { file: executable.path, args, verbatimArguments: false };
}

function defaultShell(env: Environment): Promise<string> {
  return Promise.resolve(env['SHELL'] || userInfo().shell || '/bin/zsh');
}

function shellArgs(): string[] {
  // Terminal.app and iTerm start login shells, so ~/.zprofile etc. are read.
  return ['-l'];
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** node-pty starts each terminal in its own session, so the PID is also the process group ID. */
async function killProcessTree(pid: number): Promise<void> {
  assertPid(pid);
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw error;
      }
    }
  };

  signalGroup('SIGTERM');
  const deadline = Date.now() + KILL_GRACE_MS;
  while (isAlive(-pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isAlive(-pid)) {
    signalGroup('SIGKILL');
  }
}

// "  123 Thu Oct  9 16:00:00 2026 /bin/zsh" (`lstart` in the C locale).
const PS_LINE = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/;

/** Parses `ps -o pid=,lstart=,comm=` output. Exported for tests. */
export function parsePsOutput(output: string): Map<number, ProcessInfo> {
  const result = new Map<number, ProcessInfo>();
  for (const line of output.split('\n')) {
    const match = PS_LINE.exec(line);
    if (!match) {
      continue;
    }
    const startedAt = Date.parse(match[2]!.replace(/\s+/g, ' '));
    if (Number.isNaN(startedAt)) {
      continue;
    }
    // A login shell's name starts with "-" ("-zsh").
    const name = basename(match[3]!.trim()).replace(/^-/, '');
    result.set(Number(match[1]), { name, startedAt });
  }
  return result;
}

async function processInfo(pids: number[]): Promise<Map<number, ProcessInfo>> {
  pids.forEach(assertPid);
  if (pids.length === 0) {
    return new Map();
  }
  const { code, stdout, stderr } = await run(
    '/bin/ps',
    ['-o', 'pid=,lstart=,comm=', '-p', pids.join(',')],
    { timeoutMs: 10_000, env: { ...toEnvironment(process.env), LC_ALL: 'C' } },
  );
  // ps exits 1 when none of the PIDs exist.
  if (code !== 0 && code !== 1) {
    throw new Error(`ps failed (exit ${code}): ${stderr.trim()}`);
  }
  return parsePsOutput(stdout);
}

/** Runs the login shell once and reads its environment (`env -0`, after a marker to skip any banner). */
async function loadUserEnvironment(): Promise<Environment> {
  const base = toEnvironment(process.env);
  const loginShell = await defaultShell(base);

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      loginShell,
      ['-l', '-i', '-c', `printf '%s' '${ENV_MARKER}'; /usr/bin/env -0`],
      { env: base, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Login shell did not finish within ${ENV_TIMEOUT_MS} ms`));
    }, ENV_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });

  const start = output.lastIndexOf(ENV_MARKER);
  if (start === -1) {
    throw new Error('Login shell did not print its environment');
  }

  const env: Environment = { ...base };
  for (const entry of output.slice(start + ENV_MARKER.length).split('\0')) {
    const separator = entry.indexOf('=');
    if (separator > 0) {
      env[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
  }
  return env;
}

export const darwin: Platform = {
  name: 'darwin',
  fileManagerName: 'Finder',
  defaultShell,
  shellArgs,
  resolveExecutable,
  buildCommand,
  killProcessTree,
  processInfo,
  loadUserEnvironment,
  revealInFileManager: (path) => shell.showItemInFolder(path),
};
