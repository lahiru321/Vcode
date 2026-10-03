import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { spawn as spawnPty, type IPty } from 'node-pty';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalManager, type SpawnPty, type TerminalExit, type TerminalPort } from './terminals';

const isWindows = process.platform === 'win32';

/** A pty that records calls; the test fires its data and exit callbacks. */
function fakePty(pid = 4242) {
  let dataListener: (data: string) => void = () => {};
  let exitListener: (e: { exitCode: number; signal?: number }) => void = () => {};
  const pty = {
    pid,
    onData: (listener: typeof dataListener) => {
      dataListener = listener;
      return { dispose() {} };
    },
    onExit: (listener: typeof exitListener) => {
      exitListener = listener;
      return { dispose() {} };
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  return {
    pty: pty as unknown as IPty,
    calls: pty,
    data: (data: string) => dataListener(data),
    exit: (exitCode: number, signal?: number) => exitListener({ exitCode, signal }),
  };
}

const PARAMS = {
  sessionId: 's1',
  file: '/bin/sh',
  args: ['-l'],
  cwd: '/tmp',
  env: { A: '1' },
  cols: 80,
  rows: 24,
};

describe('TerminalManager (fake pty)', () => {
  it('spawns with the given command, size, folder and environment', () => {
    const fake = fakePty();
    const spawn = vi.fn<SpawnPty>(() => fake.pty);
    const manager = new TerminalManager(spawn, vi.fn());
    expect(manager.spawn(PARAMS)).toEqual({ pid: 4242 });
    expect(spawn).toHaveBeenCalledWith('/bin/sh', ['-l'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: { A: '1' },
    });
    expect(manager.list()).toEqual([{ sessionId: 's1', pid: 4242 }]);
  });

  it('refuses a duplicate session id', () => {
    const manager = new TerminalManager(() => fakePty().pty, vi.fn());
    manager.spawn(PARAMS);
    expect(() => manager.spawn(PARAMS)).toThrow(/already exists/);
  });

  it('passes input, resize and kill to the pty', () => {
    const fake = fakePty();
    const manager = new TerminalManager(() => fake.pty, vi.fn());
    manager.spawn(PARAMS);
    manager.write('s1', 'ls\r');
    manager.resize('s1', 120, 40);
    manager.kill('s1');
    expect(fake.calls.write).toHaveBeenCalledWith('ls\r');
    expect(fake.calls.resize).toHaveBeenCalledWith(120, 40);
    expect(fake.calls.kill).toHaveBeenCalled();
  });

  it('keeps recent output, bounded', () => {
    const fake = fakePty();
    const manager = new TerminalManager(() => fake.pty, vi.fn());
    manager.spawn(PARAMS);
    fake.data('hello ');
    fake.data('world');
    expect(manager.output('s1')).toBe('hello world');
    fake.data('x'.repeat(300 * 1024));
    expect(manager.output('s1')).toHaveLength(256 * 1024);
  });

  it('reports the exit and forgets the terminal', () => {
    const fake = fakePty();
    const onExit = vi.fn<(exit: TerminalExit) => void>();
    const manager = new TerminalManager(() => fake.pty, onExit);
    manager.spawn(PARAMS);
    fake.exit(0, 0);
    expect(onExit).toHaveBeenCalledWith({ sessionId: 's1', exitCode: 0, signal: null });
    expect(manager.size).toBe(0);
    expect(() => manager.write('s1', 'x')).toThrow(/No running terminal s1/);

    manager.spawn({ ...PARAMS, sessionId: 's2' });
    fake.exit(1, 9);
    expect(onExit).toHaveBeenLastCalledWith({ sessionId: 's2', exitCode: 1, signal: 9 });
  });

  it('kills every terminal, ignoring ones that are already gone', () => {
    const a = fakePty(1);
    const b = fakePty(2);
    b.calls.kill.mockImplementation(() => {
      throw new Error('gone');
    });
    const ptys = [a.pty, b.pty];
    const manager = new TerminalManager(() => ptys.shift()!, vi.fn());
    manager.spawn({ ...PARAMS, sessionId: 'a' });
    manager.spawn({ ...PARAMS, sessionId: 'b' });
    expect(() => manager.killAll()).not.toThrow();
    expect(a.calls.kill).toHaveBeenCalled();
  });
});

/** A MessagePortMain stand-in: records what the host posts; the test plays the renderer. */
class FakePort extends EventEmitter {
  readonly posted: unknown[] = [];
  started = false;
  closed = false;
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  start(): void {
    this.started = true;
  }
  close(): void {
    this.closed = true;
    this.emit('close');
  }
  fromRenderer(data: unknown): void {
    this.emit('message', { data });
  }
}

describe('TerminalManager.attach', () => {
  function attached() {
    const fake = fakePty();
    const manager = new TerminalManager(() => fake.pty, vi.fn());
    manager.spawn(PARAMS);
    return { fake, manager };
  }

  it('replays recent output, then forwards new output', () => {
    const { fake, manager } = attached();
    fake.data('before ');
    const port = new FakePort();
    manager.attach('s1', port as unknown as TerminalPort);
    expect(port.started).toBe(true);
    fake.data('after');
    expect(port.posted).toEqual([
      { type: 'data', data: 'before ' },
      { type: 'data', data: 'after' },
    ]);
  });

  it('sends nothing on attach when there is no output yet', () => {
    const { manager } = attached();
    const port = new FakePort();
    manager.attach('s1', port as unknown as TerminalPort);
    expect(port.posted).toEqual([]);
  });

  it('passes valid input and resize to the pty and drops everything else', () => {
    const { fake, manager } = attached();
    const port = new FakePort();
    manager.attach('s1', port as unknown as TerminalPort);
    port.fromRenderer({ type: 'input', data: 'dir\r' });
    port.fromRenderer({ type: 'resize', cols: 120, rows: 40 });
    port.fromRenderer({ type: 'resize', cols: 0, rows: 40 });
    port.fromRenderer({ type: 'input', data: 42 });
    port.fromRenderer('garbage');
    expect(fake.calls.write).toHaveBeenCalledExactlyOnceWith('dir\r');
    expect(fake.calls.resize).toHaveBeenCalledExactlyOnceWith(120, 40);
  });

  it('replaces an earlier connection', () => {
    const { fake, manager } = attached();
    const first = new FakePort();
    const second = new FakePort();
    manager.attach('s1', first as unknown as TerminalPort);
    manager.attach('s1', second as unknown as TerminalPort);
    expect(first.closed).toBe(true);
    first.fromRenderer({ type: 'input', data: 'stale' });
    fake.data('x');
    expect(fake.calls.write).not.toHaveBeenCalled();
    expect(second.posted).toEqual([{ type: 'data', data: 'x' }]);
    expect(manager.isAttached('s1')).toBe(true);
  });

  it('forgets a connection the renderer closed, and keeps buffering', () => {
    const { fake, manager } = attached();
    const port = new FakePort();
    manager.attach('s1', port as unknown as TerminalPort);
    port.close();
    expect(manager.isAttached('s1')).toBe(false);
    fake.data('later');
    expect(manager.output('s1')).toBe('later');
  });

  it('tells the renderer when the process exits, then closes the port', () => {
    const { fake, manager } = attached();
    const port = new FakePort();
    manager.attach('s1', port as unknown as TerminalPort);
    fake.exit(2);
    expect(port.posted.at(-1)).toEqual({ type: 'exit', exitCode: 2, signal: null });
    expect(port.closed).toBe(true);
  });

  it('refuses an unknown terminal', () => {
    const manager = new TerminalManager(() => fakePty().pty, vi.fn());
    expect(() => manager.attach('nope', new FakePort() as unknown as TerminalPort)).toThrow(
      /No running terminal/,
    );
  });
});

describe('TerminalManager (real node-pty)', () => {
  let manager: TerminalManager | undefined;
  afterEach(() => manager?.killAll());

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
  const enter = isWindows ? '\r' : '\n';

  it('runs a real shell: input in, output out, exit reported', async () => {
    const exits: TerminalExit[] = [];
    manager = new TerminalManager(spawnPty, (exit) => exits.push(exit));
    const { pid } = manager.spawn({
      sessionId: 'real',
      file: shell,
      args: shellArgs,
      cwd: process.cwd(),
      env: { ...(process.env as Record<string, string>), VCODE_TEST: 'from-env' },
      cols: 100,
      rows: 30,
    });
    expect(pid).toBeGreaterThan(0);

    // Arithmetic, so the match is the shell's output rather than the echoed input.
    const command = isWindows
      ? 'echo "sum-$(40+2) $env:VCODE_TEST"'
      : 'echo "sum-$((40+2)) $VCODE_TEST"';
    manager.write('real', command + enter);
    await vi.waitFor(() => expect(manager!.output('real')).toContain('sum-42 from-env'), {
      timeout: 15_000,
      interval: 100,
    });

    manager.write('real', 'exit 3' + enter);
    await vi.waitFor(
      () => expect(exits).toEqual([{ sessionId: 'real', exitCode: 3, signal: null }]),
      {
        timeout: 15_000,
        interval: 100,
      },
    );
    expect(manager.size).toBe(0);
  });

  it('reports a process that cannot be started', async () => {
    // Windows fails the spawn itself; on macOS the forked child fails to exec and exits.
    const exits: TerminalExit[] = [];
    manager = new TerminalManager(spawnPty, (exit) => exits.push(exit));
    const missing = join(process.cwd(), 'definitely-missing-shell' + (isWindows ? '.exe' : ''));
    let threw = false;
    try {
      manager.spawn({ ...PARAMS, file: missing, args: [], cwd: process.cwd() });
    } catch {
      threw = true;
    }
    if (!threw) {
      await vi.waitFor(() => expect(exits).toHaveLength(1), { timeout: 10_000 });
      expect(exits[0]!.exitCode).not.toBe(0);
    }
    expect(manager.size).toBe(0);
  });
});
