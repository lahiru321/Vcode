import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { platform, type ProcessInfo } from '../platform';
import { isSessionProcess, killLeftovers } from './orphans';
import type { StaleSession } from './service';

vi.mock('electron', () => ({ shell: {} }));

const STARTED = 1_760_000_000_000;

function session(overrides: Partial<StaleSession> = {}): StaleSession {
  return {
    id: 's',
    pid: 100,
    shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    startedAt: STARTED,
    ...overrides,
  };
}

describe('isSessionProcess', () => {
  it('matches the same executable started just after the session was recorded', () => {
    expect(isSessionProcess(session(), { name: 'pwsh.exe', startedAt: STARTED + 300 })).toBe(true);
    expect(isSessionProcess(session(), { name: 'PWSH.EXE', startedAt: STARTED })).toBe(true);
    // macOS: login shells are "-zsh", start times are whole seconds.
    expect(
      isSessionProcess(session({ shell: '/bin/zsh' }), { name: 'zsh', startedAt: STARTED - 900 }),
    ).toBe(true);
  });

  it('refuses another program that got the same PID', () => {
    expect(isSessionProcess(session(), { name: 'chrome.exe', startedAt: STARTED + 300 })).toBe(
      false,
    );
  });

  it('refuses the same program started at another time', () => {
    expect(isSessionProcess(session(), { name: 'pwsh.exe', startedAt: STARTED - 10_000 })).toBe(
      false,
    );
    expect(isSessionProcess(session(), { name: 'pwsh.exe', startedAt: STARTED + 3_600_000 })).toBe(
      false,
    );
  });
});

describe('killLeftovers', () => {
  function fakePlatform(running: Record<number, ProcessInfo>) {
    return {
      processInfo: vi.fn(async (pids: number[]) => {
        const found = new Map<number, ProcessInfo>();
        for (const pid of pids) if (running[pid]) found.set(pid, running[pid]);
        return found;
      }),
      killProcessTree: vi.fn(async () => {}),
    };
  }

  it('ends only processes that are still the ones the sessions started', async () => {
    const fake = fakePlatform({
      1: { name: 'pwsh.exe', startedAt: STARTED + 100 }, // leftover
      2: { name: 'notepad.exe', startedAt: STARTED + 100 }, // PID reused
      // 3 is gone
    });
    const sessions = [
      session({ id: 'a', pid: 1 }),
      session({ id: 'b', pid: 2 }),
      session({ id: 'c', pid: 3 }),
      session({ id: 'd', pid: null }), // never got a process
    ];
    await expect(killLeftovers(sessions, fake, vi.fn())).resolves.toEqual([1]);
    expect(fake.processInfo).toHaveBeenCalledExactlyOnceWith([1, 2, 3]);
    expect(fake.killProcessTree).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('does nothing without PIDs', async () => {
    const fake = fakePlatform({});
    await expect(killLeftovers([session({ pid: null })], fake, vi.fn())).resolves.toEqual([]);
    expect(fake.processInfo).not.toHaveBeenCalled();
  });

  it('reports a failed kill and carries on', async () => {
    const fake = fakePlatform({
      1: { name: 'pwsh.exe', startedAt: STARTED },
      2: { name: 'pwsh.exe', startedAt: STARTED },
    });
    fake.killProcessTree.mockRejectedValueOnce(new Error('denied'));
    const onError = vi.fn();
    await expect(
      killLeftovers([session({ pid: 1 }), session({ pid: 2 })], fake, onError),
    ).resolves.toEqual([2]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('ends a real leftover process', async () => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const killed = await killLeftovers(
      [{ id: 'real', pid: child.pid!, shell: process.execPath, startedAt }],
      platform,
      vi.fn(),
    );
    expect(killed).toEqual([child.pid]);
    await exited;
  });
});
