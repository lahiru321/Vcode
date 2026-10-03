import { spawn } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tempDir } from '../testing';
import { darwin } from './darwin';
import { platform } from '.';

vi.mock('electron', () => ({ shell: {} }));

// Behaviour every platform must share, run against the current OS's implementation.

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}

describe('platform (current OS)', () => {
  it('picks the implementation for this OS', () => {
    expect(platform.name).toBe(process.platform === 'win32' ? 'win32' : 'darwin');
  });

  it('killProcessTree ends a process and the process it started', async () => {
    // Parent starts a grandchild, prints its PID, and both wait forever.
    const script = `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.stdout.write(String(child.pid) + '\\n');
      setInterval(() => {}, 1000);
    `;
    // node-pty gives every terminal its own session; detached does the same on POSIX.
    const parent = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: platform.name !== 'win32',
      windowsHide: true,
    });
    const grandchildPid = await new Promise<number>((resolve) =>
      parent.stdout.once('data', (data: Buffer) => resolve(Number(String(data).trim()))),
    );
    expect(isAlive(parent.pid!)).toBe(true);
    expect(isAlive(grandchildPid)).toBe(true);

    await platform.killProcessTree(parent.pid!);

    expect(await waitUntil(() => !isAlive(parent.pid!))).toBe(true);
    expect(await waitUntil(() => !isAlive(grandchildPid))).toBe(true);
  });

  it('killProcessTree accepts a process that already exited', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await new Promise((resolve) => child.once('exit', resolve));
    await expect(platform.killProcessTree(child.pid!)).resolves.toBeUndefined();
  });

  it('killProcessTree refuses invalid PIDs', async () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      await expect(platform.killProcessTree(pid)).rejects.toThrow(/Invalid process id/);
    }
  });

  it('finds this Node.js by absolute path', async () => {
    await expect(platform.resolveExecutable(process.execPath, { PATH: '' })).resolves.toMatchObject(
      { kind: 'binary' },
    );
  });

  it('returns null for a command that does not exist', async () => {
    await expect(
      platform.resolveExecutable('vcode-no-such-command', { PATH: tempDir() }),
    ).resolves.toBeNull();
  });

  it('defaultShell returns an absolute path', async () => {
    const shell = await platform.defaultShell(
      Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
        string,
        string
      >,
    );
    expect(shell).toMatch(platform.name === 'win32' ? /^[A-Za-z]:\\/ : /^\//);
  });
});

describe.runIf(process.platform !== 'win32')('darwin', () => {
  it('resolves commands on PATH, only if executable', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'tool'), '#!/bin/sh\n');
    writeFileSync(join(dir, 'data'), '');
    chmodSync(join(dir, 'tool'), 0o755);
    const env = { PATH: `relative:${dir}` };
    await expect(darwin.resolveExecutable('tool', env)).resolves.toEqual({
      path: join(dir, 'tool'),
      kind: 'binary',
    });
    await expect(darwin.resolveExecutable('data', env)).resolves.toBeNull();
    await expect(darwin.resolveExecutable('./tool', env)).resolves.toBeNull();
    await expect(darwin.resolveExecutable(join(dir, 'data'), env)).resolves.toBeNull();
  });

  it('starts shells as login shells and never quotes arguments', () => {
    expect(darwin.shellArgs('/bin/zsh')).toEqual(['-l']);
    expect(darwin.buildCommand({ path: '/bin/x', kind: 'binary' }, ['a b'], {})).toEqual({
      file: '/bin/x',
      args: ['a b'],
      verbatimArguments: false,
    });
  });

  it('uses $SHELL as the default shell', async () => {
    await expect(darwin.defaultShell({ SHELL: '/bin/bash' })).resolves.toBe('/bin/bash');
  });

  it('loads the login shell environment', async () => {
    const env = await darwin.loadUserEnvironment();
    expect(env['PATH']).toMatch(/\/usr\/bin/);
    expect(env['HOME']).toBeTruthy();
  });
});
