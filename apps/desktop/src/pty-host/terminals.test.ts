import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { spawn as spawnPty, type IPty } from 'node-pty';
import {
  FLOW_HIGH_WATERMARK,
  FLOW_LOW_WATERMARK,
  OUTPUT_BATCH_MS,
} from '@vcode/shared/terminal-port';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    pause: vi.fn(),
    resume: vi.fn(),
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

  it('keeps the current screen, not the raw output', async () => {
    const fake = fakePty();
    const manager = new TerminalManager(() => fake.pty, vi.fn());
    manager.spawn(PARAMS);
    fake.data('hello\r\nworld');
    await vi.waitFor(() => expect(manager.output('s1')).toBe('hello\r\nworld'));
    fake.data('\x1b[2J\x1b[Hcleared'); // clear the screen, then write
    await vi.waitFor(() => expect(manager.output('s1')).toContain('cleared'));
    expect(manager.output('s1')).not.toContain('world');
  });

  it('resizes the pty and the screen', async () => {
    const fake = fakePty();
    const manager = new TerminalManager(() => fake.pty, vi.fn());
    manager.spawn(PARAMS);
    manager.resize('s1', 10, 5);
    expect(fake.calls.resize).toHaveBeenCalledWith(10, 5);
    fake.data('0123456789abc'); // wraps at 10 columns
    await vi.waitFor(() => expect(manager.output('s1')).toContain('abc'));
    expect(manager.output('s1')).toMatch(/0123456789(\r\n)?abc/);
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
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function attached() {
    const fake = fakePty();
    const manager = new TerminalManager(() => fake.pty, vi.fn());
    manager.spawn(PARAMS);
    return { fake, manager };
  }

  /** Lets the screen mirror process its output (it parses on a timer). */
  const parse = () => vi.advanceTimersByTimeAsync(1);

  /** Attaches a port and waits until the screen has been sent. */
  async function attach(manager: TerminalManager) {
    const port = new FakePort();
    manager.attach('s1', port as unknown as TerminalPort);
    await parse();
    return port;
  }

  it('sends the current screen, then forwards new output', async () => {
    const { fake, manager } = attached();
    fake.data('one\r\ntwo');
    const port = await attach(manager);
    expect(port.started).toBe(true);
    fake.data('three');
    await vi.advanceTimersByTimeAsync(OUTPUT_BATCH_MS);
    expect(port.posted).toEqual([
      { type: 'data', data: 'one\r\ntwo' },
      { type: 'data', data: 'three' },
    ]);
  });

  it('sends the screen as it is now, not the output that led to it', async () => {
    const { fake, manager } = attached();
    fake.data('old text\x1b[2J\x1b[H\x1b[31mred\x1b[0m');
    const port = await attach(manager);
    expect(port.posted).toHaveLength(1);
    const { data } = port.posted[0] as { data: string };
    expect(data).toContain('\x1b[31mred');
    expect(data).not.toContain('old text');
  });

  it('holds new output back until the screen has been sent', async () => {
    const { fake, manager } = attached();
    fake.data('screen');
    const port = new FakePort();
    manager.attach('s1', port as unknown as TerminalPort);
    fake.data(' more'); // arrives while the screen is being prepared
    await vi.advanceTimersByTimeAsync(OUTPUT_BATCH_MS);
    expect(port.posted).toEqual([
      { type: 'data', data: 'screen' },
      { type: 'data', data: ' more' },
    ]);
  });

  it('sends output in batches', async () => {
    const { fake, manager } = attached();
    const port = await attach(manager);
    fake.data('a');
    fake.data('b');
    expect(port.posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(OUTPUT_BATCH_MS);
    fake.data('c');
    await vi.advanceTimersByTimeAsync(OUTPUT_BATCH_MS);
    expect(port.posted).toEqual([
      { type: 'data', data: 'ab' },
      { type: 'data', data: 'c' },
    ]);
  });

  it('pauses the process while the renderer is behind, and resumes it once it catches up', async () => {
    const { fake, manager } = attached();
    const port = await attach(manager);
    const chunk = 'x'.repeat(FLOW_HIGH_WATERMARK / 2);

    fake.data(chunk);
    await vi.advanceTimersByTimeAsync(OUTPUT_BATCH_MS);
    expect(fake.calls.pause).not.toHaveBeenCalled();
    fake.data(chunk);
    fake.data('y'); // still waiting for its batch, but counts
    expect(fake.calls.pause).toHaveBeenCalledOnce();
    expect(manager.isPaused('s1')).toBe(true);
    await vi.advanceTimersByTimeAsync(OUTPUT_BATCH_MS);

    port.fromRenderer({ type: 'ack', chars: chunk.length });
    expect(fake.calls.resume).not.toHaveBeenCalled(); // still above the low watermark
    port.fromRenderer({ type: 'ack', chars: chunk.length + 1 - FLOW_LOW_WATERMARK + 1 });
    expect(fake.calls.resume).toHaveBeenCalledOnce();
    expect(manager.isPaused('s1')).toBe(false);
  });

  it('counts the screen it sends as unacknowledged output', async () => {
    const { fake, manager } = attached();
    // More than the high watermark even after scrolling off the 24-row screen.
    fake.data('x'.repeat(80).concat('\r\n').repeat(2000));
    expect(fake.calls.pause).not.toHaveBeenCalled(); // nobody attached: no back-pressure
    const port = await attach(manager);
    const { data } = port.posted[0] as { data: string };
    expect(data.length).toBeGreaterThan(FLOW_HIGH_WATERMARK);
    expect(fake.calls.pause).toHaveBeenCalledOnce();
    port.fromRenderer({ type: 'ack', chars: data.length });
    expect(fake.calls.resume).toHaveBeenCalledOnce();
  });

  it('resumes a paused process when the renderer goes away', async () => {
    const { fake, manager } = attached();
    const port = await attach(manager);
    fake.data('x'.repeat(FLOW_HIGH_WATERMARK + 1));
    expect(manager.isPaused('s1')).toBe(true);
    port.close();
    expect(fake.calls.resume).toHaveBeenCalledOnce();
    expect(manager.isPaused('s1')).toBe(false);
  });

  it('sends nothing on attach when there is no output yet', async () => {
    const { manager } = attached();
    const port = await attach(manager);
    expect(port.posted).toEqual([]);
  });

  it('passes valid input and resize to the pty and drops everything else', async () => {
    const { fake, manager } = attached();
    const port = await attach(manager);
    port.fromRenderer({ type: 'input', data: 'dir\r' });
    port.fromRenderer({ type: 'resize', cols: 120, rows: 40 });
    port.fromRenderer({ type: 'resize', cols: 0, rows: 40 });
    port.fromRenderer({ type: 'input', data: 42 });
    port.fromRenderer('garbage');
    expect(fake.calls.write).toHaveBeenCalledExactlyOnceWith('dir\r');
    expect(fake.calls.resize).toHaveBeenCalledExactlyOnceWith(120, 40);
  });

  it('replaces an earlier connection', async () => {
    const { fake, manager } = attached();
    const first = new FakePort();
    manager.attach('s1', first as unknown as TerminalPort);
    const second = await attach(manager); // before the first got its screen
    expect(first.closed).toBe(true);
    first.fromRenderer({ type: 'input', data: 'stale' });
    fake.data('x');
    await vi.advanceTimersByTimeAsync(OUTPUT_BATCH_MS);
    expect(fake.calls.write).not.toHaveBeenCalled();
    expect(first.posted).toEqual([]);
    expect(second.posted).toEqual([{ type: 'data', data: 'x' }]);
    expect(manager.isAttached('s1')).toBe(true);
  });

  it('forgets a connection the renderer closed, and keeps the screen', async () => {
    const { fake, manager } = attached();
    const port = await attach(manager);
    port.close();
    expect(manager.isAttached('s1')).toBe(false);
    fake.data('later');
    await parse();
    expect(manager.output('s1')).toBe('later');
    expect(port.posted).toEqual([]);
  });

  it('sends the last output, then tells the renderer the process exited and closes the port', async () => {
    const { fake, manager } = attached();
    const port = await attach(manager);
    fake.data('bye');
    fake.exit(2);
    expect(port.posted).toEqual([
      { type: 'data', data: 'bye' },
      { type: 'exit', exitCode: 2, signal: null },
    ]);
    expect(port.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(OUTPUT_BATCH_MS);
    expect(port.posted).toHaveLength(2);
  });

  it('sends the screen before the exit when the process ends during attach', async () => {
    const onExit = vi.fn();
    const fake = fakePty();
    const manager = new TerminalManager(() => fake.pty, onExit);
    manager.spawn(PARAMS);
    fake.data('last words');
    const port = new FakePort();
    manager.attach('s1', port as unknown as TerminalPort);
    fake.exit(0);
    expect(onExit).toHaveBeenCalledOnce(); // main is told right away
    await parse();
    expect(port.posted).toEqual([
      { type: 'data', data: 'last words' },
      { type: 'exit', exitCode: 0, signal: null },
    ]);
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

  it('pauses a noisy process until the renderer catches up', async () => {
    const exits: TerminalExit[] = [];
    manager = new TerminalManager(spawnPty, (exit) => exits.push(exit));
    manager.spawn({
      sessionId: 'noisy',
      file: shell,
      args: shellArgs,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 100,
      rows: 30,
    });
    const port = new FakePort();
    manager.attach('noisy', port as unknown as TerminalPort);

    // Far more output than the high watermark; the renderer acknowledges nothing yet.
    const command = isWindows
      ? '1..20000 | ForEach-Object { "line $_ of noisy output" }; exit 0'
      : 'i=0; while [ $i -lt 20000 ]; do echo "line $i of noisy output"; i=$((i+1)); done; exit 0';
    manager.write('noisy', command + enter);
    await vi.waitFor(() => expect(manager!.isPaused('noisy')).toBe(true), {
      timeout: 15_000,
      interval: 50,
    });
    expect(exits).toEqual([]);

    // Now draw everything as it arrives: the process resumes and finishes.
    let acked = 0;
    await vi.waitFor(
      () => {
        const sent = port.posted
          .filter(
            (m): m is { type: 'data'; data: string } => (m as { type: string }).type === 'data',
          )
          .reduce((n, m) => n + m.data.length, 0);
        if (sent > acked) {
          port.fromRenderer({ type: 'ack', chars: sent - acked });
          acked = sent;
        }
        expect(exits).toHaveLength(1);
      },
      { timeout: 30_000, interval: 50 },
    );
    expect(exits[0]!.exitCode).toBe(0);
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
