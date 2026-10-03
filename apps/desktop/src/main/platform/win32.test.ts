import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tempDir } from '../testing';
import type { Environment } from './types';
import { mergeEnvironment, win32 } from './win32';

vi.mock('electron', () => ({ shell: {} }));

const isWindows = process.platform === 'win32';

/** Creates empty files named `names` in `dir`; returns `dir`. */
function files(dir: string, ...names: string[]): string {
  for (const name of names) {
    writeFileSync(join(dir, name), '');
  }
  return dir;
}

describe('mergeEnvironment', () => {
  it('layers user over machine over process, case-insensitively', () => {
    const env = mergeEnvironment(
      { Path: 'proc', TEMP: 'proc-temp', HOMEDRIVE: 'C:', OnlyProcess: '1' },
      { PATH: 'C:\\Windows', Temp: 'machine-temp', OnlyMachine: '2' },
      { path: 'C:\\Users\\me\\bin', TEMP: 'user-temp' },
    );
    expect(env).toEqual({
      Path: 'C:\\Windows;C:\\Users\\me\\bin', // first spelling kept; system then user
      TEMP: 'user-temp',
      HOMEDRIVE: 'C:',
      OnlyProcess: '1',
      OnlyMachine: '2',
    });
  });

  it('keeps the process PATH when the registry has none', () => {
    expect(mergeEnvironment({ PATH: 'proc' }, {}, {})).toEqual({ PATH: 'proc' });
  });

  it('uses whichever registry PATH exists', () => {
    expect(mergeEnvironment({}, {}, { Path: 'user' })).toEqual({ Path: 'user' });
  });
});

describe('win32.buildCommand', () => {
  const env: Environment = { SystemRoot: 'C:\\Windows' };

  it('runs binaries directly', () => {
    expect(
      win32.buildCommand({ path: 'C:\\x\\a.exe', kind: 'binary' }, ['-v', 'a b'], env),
    ).toEqual({ file: 'C:\\x\\a.exe', args: ['-v', 'a b'], verbatimArguments: false });
  });

  it('runs .ps1 through Windows PowerShell without bypassing the execution policy', () => {
    const command = win32.buildCommand({ path: 'C:\\x\\a.ps1', kind: 'powershell' }, ['1'], env);
    expect(command.file).toMatch(/WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
    expect(command.args).toEqual(['-NoLogo', '-NoProfile', '-File', 'C:\\x\\a.ps1', '1']);
    expect(command.args).not.toContain('Bypass');
  });

  it('runs .cmd through cmd.exe with AutoRun off and pre-quoted arguments', () => {
    const command = win32.buildCommand({ path: 'C:\\x\\a.cmd', kind: 'batch' }, ['a b'], env);
    expect(command.file).toMatch(/System32[\\/]cmd\.exe$/);
    expect(command.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(command.verbatimArguments).toBe(true);
  });
});

describe('win32.shellArgs', () => {
  it('adds -NoLogo for PowerShell only', () => {
    expect(win32.shellArgs('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toEqual(['-NoLogo']);
    expect(win32.shellArgs('C:\\Windows\\System32\\cmd.exe')).toEqual([]);
  });
});

describe.runIf(isWindows)('win32.resolveExecutable', () => {
  it('searches PATH in order, then PATHEXT in order', async () => {
    const first = files(tempDir(), 'tool.cmd');
    const second = files(tempDir(), 'tool.exe');
    const env = { PATH: `${first};${second}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    await expect(win32.resolveExecutable('tool', env)).resolves.toEqual({
      path: join(first, 'tool.cmd'),
      kind: 'batch',
    });

    const both = files(tempDir(), 'tool.cmd', 'tool.exe');
    await expect(
      win32.resolveExecutable('tool', { PATH: both, PATHEXT: '.EXE;.CMD' }),
    ).resolves.toMatchObject({ kind: 'binary' });
    await expect(
      win32.resolveExecutable('tool', { PATH: both, PATHEXT: '.CMD;.EXE' }),
    ).resolves.toMatchObject({ kind: 'batch' });
  });

  it('reads Path and PATHEXT case-insensitively and accepts quoted PATH entries', async () => {
    const dir = files(join(tempDir()), 'tool.bat');
    const spaced = join(dir, 'with space');
    mkdirSync(spaced);
    files(spaced, 'other.exe');
    const env = { Path: `"${spaced}";${dir}`, PathExt: '.bat;.exe' };
    await expect(win32.resolveExecutable('tool', env)).resolves.toMatchObject({ kind: 'batch' });
    await expect(win32.resolveExecutable('other', env)).resolves.toEqual({
      path: join(spaced, 'other.exe'),
      kind: 'binary',
    });
  });

  it('only runs known types, even if PATHEXT lists more', async () => {
    const dir = files(tempDir(), 'tool.js', 'tool.vbs');
    const env = { PATH: dir, PATHEXT: '.JS;.VBS' };
    await expect(win32.resolveExecutable('tool', env)).resolves.toBeNull();
    // An empty or useless PATHEXT falls back to .com/.exe/.bat/.cmd.
    files(dir, 'tool.exe');
    await expect(win32.resolveExecutable('tool', env)).resolves.toMatchObject({ kind: 'binary' });
  });

  it('finds .ps1 only when given as a path', async () => {
    const dir = files(tempDir(), 'script.ps1');
    await expect(win32.resolveExecutable('script', { PATH: dir })).resolves.toBeNull();
    await expect(win32.resolveExecutable(join(dir, 'script.ps1'), {})).resolves.toEqual({
      path: join(dir, 'script.ps1'),
      kind: 'powershell',
    });
  });

  it('accepts a name with its extension, and an absolute path without one', async () => {
    const dir = files(tempDir(), 'npm.cmd');
    await expect(win32.resolveExecutable('npm.cmd', { PATH: dir })).resolves.toMatchObject({
      kind: 'batch',
    });
    await expect(win32.resolveExecutable(join(dir, 'npm'), {})).resolves.toMatchObject({
      path: join(dir, 'npm.cmd'),
    });
  });

  it('refuses relative paths and never searches the current folder', async () => {
    const dir = files(tempDir(), 'tool.exe');
    await expect(win32.resolveExecutable('.\\tool', { PATH: dir })).resolves.toBeNull();
    await expect(win32.resolveExecutable('sub/tool', { PATH: dir })).resolves.toBeNull();
    await expect(win32.resolveExecutable('   ', { PATH: dir })).resolves.toBeNull();

    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await expect(
        win32.resolveExecutable('tool', { PATH: 'relative;C:\\nowhere' }),
      ).resolves.toBeNull();
    } finally {
      process.chdir(cwd);
    }
  });

  it('ignores folders that look like executables', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'tool.exe'));
    await expect(win32.resolveExecutable('tool', { PATH: dir })).resolves.toBeNull();
  });

  const aliasDir = join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'WindowsApps');
  // Listed, not existsSync(): stat() can't follow an alias, which is what this test is about.
  const hasWingetAlias = (() => {
    try {
      return readdirSync(aliasDir).includes('winget.exe');
    } catch {
      return false;
    }
  })();
  it.runIf(hasWingetAlias)(
    'finds app execution aliases (reparse points stat() cannot follow)',
    async () => {
      await expect(win32.resolveExecutable('winget', { PATH: aliasDir })).resolves.toEqual({
        path: join(aliasDir, 'winget.exe'),
        kind: 'binary',
      });
    },
  );
});

describe.runIf(isWindows)('win32 .cmd argument round-trip', () => {
  // The arguments an npm shim's target receives must equal what we passed, character for
  // character: nothing expanded (%VAR%, !VAR!), nothing run (&, |), nothing lost (^, quotes).
  const TRICKY = [
    'plain',
    'with space',
    '',
    ' ',
    'double"quote',
    '"',
    '""',
    "single'quote",
    'back\\slash',
    'trailing\\',
    'trailing\\\\',
    '\\"',
    'C:\\Program Files\\x\\',
    '%PATH%',
    '%%',
    '%~dp0',
    '!PATH!',
    '^caret^',
    'a&b',
    'a|b',
    'a<b>c',
    '(paren)',
    'semi;colon,comma',
    'star*?',
    '`tick`',
    'key=value',
    'tab\there',
    'ünïcödé 日本 🚀',
    '--flag="quoted value"',
    '& calc.exe',
  ];

  it(`passes ${TRICKY.length} tricky arguments through a shim unchanged`, async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'echo.cjs'),
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
    );
    // Shaped like an npm shim: the target script, then %* (the arguments as given).
    writeFileSync(join(dir, 'echo.cmd'), `@"${process.execPath}" "%~dp0echo.cjs" %*\r\n`);

    const env = { ...process.env, PATH: dir } as Environment;
    const executable = await win32.resolveExecutable('echo', env);
    expect(executable).toMatchObject({ kind: 'batch' });
    const command = win32.buildCommand(executable!, TRICKY, env);

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        command.file,
        command.args,
        { windowsVerbatimArguments: command.verbatimArguments, encoding: 'utf8', env },
        (error, out) => (error ? reject(error) : resolve(out)),
      );
    });
    expect(JSON.parse(stdout)).toEqual(TRICKY);
  });

  it('handles a shim whose path has spaces and metacharacters', async () => {
    const dir = join(tempDir(), 'dir with (parens) & spaces');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'echo.cjs'),
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
    );
    writeFileSync(join(dir, 'echo.cmd'), `@"${process.execPath}" "%~dp0echo.cjs" %*\r\n`);
    const env = { ...process.env } as Environment;
    const command = win32.buildCommand({ path: join(dir, 'echo.cmd'), kind: 'batch' }, ['ok'], env);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(command.file, command.args, { windowsVerbatimArguments: true, env }, (error, out) =>
        error ? reject(error) : resolve(String(out)),
      );
    });
    expect(JSON.parse(stdout)).toEqual(['ok']);
  });
});

describe.runIf(isWindows)('win32 shell and environment', () => {
  it('falls back to Windows PowerShell when pwsh is not on PATH', async () => {
    const shell = await win32.defaultShell({ PATH: tempDir(), SystemRoot: 'C:\\Windows' });
    expect(shell).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('prefers pwsh when it is on PATH', async () => {
    const dir = files(tempDir(), 'pwsh.exe');
    await expect(win32.defaultShell({ PATH: dir })).resolves.toBe(join(dir, 'pwsh.exe'));
  });

  it('loads the registry environment', async () => {
    const env = await win32.loadUserEnvironment();
    const names = Object.keys(env).map((name) => name.toUpperCase());
    expect(new Set(names).size).toBe(names.length); // no PATH and Path side by side
    const path = Object.entries(env).find(([name]) => name.toUpperCase() === 'PATH')?.[1];
    expect(path?.toLowerCase()).toContain('system32');
    expect(Object.keys(env).some((name) => name.toUpperCase() === 'USERPROFILE')).toBe(true);
  });
});
