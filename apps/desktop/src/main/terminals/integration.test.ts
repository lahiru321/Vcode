import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn as spawnPty } from 'node-pty';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalClientMessage, TerminalHostMessage } from '@vcode/shared/terminal-port';
import { TerminalManager, type TerminalExit, type TerminalPort } from '../../pty-host/terminals';
import { platform, toEnvironment } from '../platform';
import { tempDir } from '../testing';

vi.mock('electron', () => ({ shell: {} }));

// P2-11: the terminal path end to end, minus Electron — a real shell in node-pty (the PTY host's
// TerminalManager), a renderer port that draws and acknowledges output, and the real
// platform.killProcessTree that `terminals:stop` uses. The shell starts a child process; stopping
// the terminal must end both (V1 acceptance: "stopping it ends its whole process tree").

const isWindows = process.platform === 'win32';
const enter = isWindows ? '\r' : '\n';
const shell = isWindows
  ? join(
      process.env['SystemRoot'] ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
  : '/bin/sh';
const shellArgs = isWindows ? ['-NoLogo', '-NoProfile'] : [];

/** Plays the renderer: collects what it is sent and acknowledges it, as TerminalView does. */
class RendererPort extends EventEmitter {
  text = '';
  exit: TerminalHostMessage | undefined;
  postMessage(message: TerminalHostMessage): void {
    if (message.type === 'data') {
      this.text += message.data;
      this.send({ type: 'ack', chars: message.data.length });
    } else {
      this.exit = message;
    }
  }
  send(message: TerminalClientMessage): void {
    this.emit('message', { data: message });
  }
  start(): void {}
  close(): void {
    this.emit('close');
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Single-quoted for PowerShell and sh alike (neither path contains a quote). */
const quote = (value: string): string => `'${value}'`;

describe('terminal end to end (real shell)', () => {
  let manager: TerminalManager | undefined;
  let childPid: number | undefined;
  afterEach(() => {
    manager?.killAll();
    if (childPid && isAlive(childPid)) process.kill(childPid);
  });

  it('spawns a shell, echoes text, and stopping it kills the shell and its child', async () => {
    const exits: TerminalExit[] = [];
    manager = new TerminalManager(spawnPty, (exit) => exits.push(exit));
    const { pid } = manager.spawn({
      sessionId: 'e2e',
      file: shell,
      args: shellArgs,
      cwd: process.cwd(),
      env: toEnvironment(process.env),
      cols: 120,
      rows: 30,
    });
    const port = new RendererPort();
    manager.attach('e2e', port as unknown as TerminalPort);
    const wait = { timeout: 15_000, interval: 50 };

    // Typed input reaches the shell; its output reaches the renderer.
    // Arithmetic, so the match is the shell's output rather than the echoed input.
    const echo = isWindows ? 'echo "e2e-$(40+2)"' : 'echo "e2e-$((40+2))"';
    port.send({ type: 'input', data: echo + enter });
    await vi.waitFor(() => expect(port.text).toContain('e2e-42'), wait);

    // A long-running child of the shell, which reports its PID.
    const script = join(tempDir(), 'child.js');
    writeFileSync(script, "console.log('child-pid:' + process.pid); setInterval(() => {}, 1000);");
    const run = isWindows ? '& ' : '';
    port.send({ type: 'input', data: `${run}${quote(process.execPath)} ${quote(script)}` + enter });
    await vi.waitFor(() => expect(port.text).toMatch(/child-pid:\d+/), wait);
    childPid = Number(/child-pid:(\d+)/.exec(port.text)![1]);
    expect(childPid).not.toBe(pid);
    expect(isAlive(childPid)).toBe(true);

    // Stop, as terminals:stop does it.
    await platform.killProcessTree(pid);

    await vi.waitFor(() => expect(exits.map((e) => e.sessionId)).toEqual(['e2e']), wait);
    expect(port.exit).toMatchObject({ type: 'exit' });
    await vi.waitFor(() => expect(isAlive(childPid!)).toBe(false), wait);
    expect(manager.size).toBe(0);
  });
});
