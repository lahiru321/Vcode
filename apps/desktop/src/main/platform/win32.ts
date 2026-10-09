import { lstat, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize } from 'node:path';
import { shell } from 'electron';
import { assertPid, run, toEnvironment } from './common';
import type {
  Command,
  Environment,
  Executable,
  ExecutableKind,
  Platform,
  ProcessInfo,
} from './types';

const RUNNABLE_EXTENSIONS: Record<string, ExecutableKind> = {
  '.com': 'binary',
  '.exe': 'binary',
  '.bat': 'batch',
  '.cmd': 'batch',
  '.ps1': 'powershell',
};
const DEFAULT_PATHEXT = ['.com', '.exe', '.bat', '.cmd'];

/** Windows environment names are case-insensitive (`Path` vs `PATH`). */
function getEnv(env: Environment, name: string): string | undefined {
  const wanted = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

function systemRoot(env: Environment): string {
  return getEnv(env, 'SystemRoot') ?? process.env['SystemRoot'] ?? 'C:\\Windows';
}

function system32(env: Environment, file: string): string {
  return join(systemRoot(env), 'System32', file);
}

function windowsPowerShell(env: Environment): string {
  return system32(env, join('WindowsPowerShell', 'v1.0', 'powershell.exe'));
}

/** PATHEXT, limited to the types we know how to start (no .js / .vbs / .wsf …). */
function pathExtensions(env: Environment): string[] {
  const fromEnv = (getEnv(env, 'PATHEXT') ?? '')
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext in RUNNABLE_EXTENSIONS);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_PATHEXT;
}

function pathDirectories(env: Environment): string[] {
  return (getEnv(env, 'PATH') ?? '')
    .split(';')
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter((dir) => dir.length > 0 && isAbsolute(dir));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    // App execution aliases (e.g. pwsh.exe from the Store in …\WindowsApps) are reparse
    // points that stat() can't follow, but they can still be launched.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false;
    }
    try {
      await lstat(path);
      return true;
    } catch {
      return false;
    }
  }
}

function classify(path: string): ExecutableKind | undefined {
  return RUNNABLE_EXTENSIONS[extname(path).toLowerCase()];
}

/** `name` as given if it already has a runnable extension, otherwise `name` + each PATHEXT entry. */
function candidates(base: string, env: Environment): string[] {
  return classify(base) ? [base] : pathExtensions(env).map((ext) => base + ext);
}

async function resolveExecutable(command: string, env: Environment): Promise<Executable | null> {
  const name = command.trim();
  if (name.length === 0) {
    return null;
  }

  let searchList: string[];
  if (isAbsolute(name)) {
    searchList = candidates(normalize(name), env);
  } else if (/[\\/]/.test(name)) {
    return null;
  } else {
    // Unlike cmd.exe, never search the current directory first.
    searchList = pathDirectories(env).flatMap((dir) => candidates(join(dir, name), env));
  }

  for (const path of searchList) {
    const kind = classify(path);
    if (kind && (await isFile(path))) {
      return { path, kind };
    }
  }
  return null;
}

// cmd.exe quoting, after cross-spawn (MIT): https://github.com/moxystudio/node-cross-spawn
// Every metacharacter — including the quotes we add — is ^-escaped, so cmd.exe never enters
// quote mode and treats the whole line literally. Arguments are escaped twice because npm
// shims re-parse them when they expand %* into their own command line.
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

function escapeCmdCommand(path: string): string {
  return path.replace(CMD_META_CHARS, '^$1');
}

function escapeCmdArgument(arg: string): string {
  // cmd.exe ends the command at a line break, dropping the rest of the line (later arguments
  // too), and no escape gets one through. Multi-line text (e.g. agent instructions) is passed
  // on one line instead.
  arg = arg.replace(/\r\n|\r|\n/g, ' ');
  // Standard argv quoting (CommandLineToArgvW / MSVCRT rules) first: backslashes before a
  // quote — or before the closing quote we add — are doubled, and quotes are backslash-escaped.
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
  return quoted.replace(CMD_META_CHARS, '^$1').replace(CMD_META_CHARS, '^$1');
}

function buildCommand(executable: Executable, args: string[], env: Environment): Command {
  switch (executable.kind) {
    case 'binary':
      return { file: executable.path, args, verbatimArguments: false };
    case 'batch': {
      const line = [escapeCmdCommand(executable.path), ...args.map(escapeCmdArgument)].join(' ');
      return {
        file: system32(env, 'cmd.exe'),
        // /d: skip AutoRun commands from the registry. /s /c: run the quoted line as is.
        args: ['/d', '/s', '/c', `"${line}"`],
        verbatimArguments: true,
      };
    }
    case 'powershell':
      // Runs under the user's execution policy; we don't bypass it.
      return {
        file: windowsPowerShell(env),
        args: ['-NoLogo', '-NoProfile', '-File', executable.path, ...args],
        verbatimArguments: false,
      };
  }
}

async function defaultShell(env: Environment): Promise<string> {
  // PowerShell 7 if installed, otherwise the Windows PowerShell that ships with Windows.
  const pwsh = await resolveExecutable('pwsh', env);
  return pwsh?.kind === 'binary' ? pwsh.path : windowsPowerShell(env);
}

function shellArgs(shellPath: string): string[] {
  const name = shellPath.toLowerCase();
  return name.endsWith('pwsh.exe') || name.endsWith('powershell.exe') ? ['-NoLogo'] : [];
}

async function killProcessTree(pid: number): Promise<void> {
  assertPid(pid);
  const env = toEnvironment(process.env);
  const { code, stderr } = await run(
    system32(env, 'taskkill.exe'),
    ['/PID', String(pid), '/T', '/F'],
    { timeoutMs: 10_000 },
  );
  // 128: no such process — it already exited.
  if (code !== 0 && code !== 128) {
    throw new Error(`taskkill failed for PID ${pid} (exit ${code}): ${stderr.trim()}`);
  }
}

/** One CIM query for all PIDs; `-InputObject` keeps a single result an array. */
function processInfoScript(pids: number[]): string {
  const filter = pids.map((pid) => `ProcessId=${pid}`).join(' OR ');
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$found = @(Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { @{ pid = [int]$_.ProcessId; name = [string]$_.Name; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } })`,
    'ConvertTo-Json -InputObject $found -Compress',
  ].join('; ');
}

async function processInfo(pids: number[]): Promise<Map<number, ProcessInfo>> {
  pids.forEach(assertPid); // they end up in the script
  const result = new Map<number, ProcessInfo>();
  if (pids.length === 0) {
    return result;
  }
  const env = toEnvironment(process.env);
  const { code, stdout, stderr } = await run(
    windowsPowerShell(env),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', processInfoScript(pids)],
    { timeoutMs: 15_000 },
  );
  if (code !== 0) {
    throw new Error(`Reading process information failed (exit ${code}): ${stderr.trim()}`);
  }
  const found = JSON.parse(stdout) as { pid: number; name: string; startedAt: number }[];
  for (const { pid, name, startedAt } of found) {
    result.set(pid, { name, startedAt });
  }
  return result;
}

// [Environment]::GetEnvironmentVariables expands REG_EXPAND_SZ values. Output is forced to
// UTF-8 so non-ASCII user names and paths survive.
const READ_ENVIRONMENT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "@{ machine = [Environment]::GetEnvironmentVariables('Machine'); user = [Environment]::GetEnvironmentVariables('User') } | ConvertTo-Json -Compress",
].join('; ');

async function loadUserEnvironment(): Promise<Environment> {
  const base = toEnvironment(process.env);
  const { code, stdout, stderr } = await run(
    windowsPowerShell(base),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', READ_ENVIRONMENT_SCRIPT],
    { timeoutMs: 15_000 },
  );
  if (code !== 0) {
    throw new Error(`Reading the user environment failed (exit ${code}): ${stderr.trim()}`);
  }

  const { machine, user } = JSON.parse(stdout) as { machine: Environment; user: Environment };
  return mergeEnvironment(base, machine, user);
}

/**
 * Process variables (USERPROFILE, APPDATA, … from the logon session) are the base; registry
 * values replace them, user over machine — the same order Windows uses for a new process.
 * Names are case-insensitive; the first spelling seen is kept.
 */
export function mergeEnvironment(
  base: Environment,
  machine: Environment,
  user: Environment,
): Environment {
  const merged = new Map<string, [name: string, value: string]>();
  const set = (name: string, value: string): void => {
    const key = name.toUpperCase();
    merged.set(key, [merged.get(key)?.[0] ?? name, value]);
  };
  for (const source of [base, machine, user]) {
    for (const [name, value] of Object.entries(source)) {
      set(name, String(value));
    }
  }

  // PATH is the one variable Windows concatenates instead of overriding: system, then user.
  const path = [getEnv(machine, 'PATH'), getEnv(user, 'PATH')].filter(Boolean).join(';');
  if (path) {
    set('PATH', path);
  }

  return Object.fromEntries(merged.values());
}

export const win32: Platform = {
  name: 'win32',
  fileManagerName: 'Explorer',
  defaultShell,
  shellArgs,
  resolveExecutable,
  buildCommand,
  killProcessTree,
  processInfo,
  loadUserEnvironment,
  revealInFileManager: (path) => shell.showItemInFolder(path),
};
