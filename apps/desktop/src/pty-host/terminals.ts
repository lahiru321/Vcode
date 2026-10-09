import {
  FLOW_HIGH_WATERMARK,
  FLOW_LOW_WATERMARK,
  OUTPUT_BATCH_MS,
  parseTerminalClientMessage,
  type TerminalHostMessage,
} from '@vcode/shared/terminal-port';
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import { ActivityTracker, type ActivitySignal } from './activity';
import { ScreenMirror } from './mirror';
import type { SpawnParams } from './protocol';

// Every pseudo-terminal the host owns, keyed by terminal_sessions id. node-pty's `spawn` is
// passed in so the manager can be tested with a fake.

export type SpawnPty = (
  file: string,
  args: string[] | string,
  options: IPtyForkOptions | IWindowsPtyForkOptions,
) => IPty;

export interface TerminalExit {
  sessionId: string;
  exitCode: number;
  signal: number | null;
}

/** The parts of Electron's MessagePortMain used for a terminal's renderer connection. */
export interface TerminalPort {
  postMessage(message: TerminalHostMessage): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  start(): void;
  close(): void;
}

interface Terminal {
  pty: IPty;
  /** The current screen, for renderers that attach later. */
  mirror: ScreenMirror;
  /** The renderer's connection, if one is attached. */
  port?: TerminalPort;
  /** Set while the screen is being sent to a new renderer; new output waits behind it. */
  replay?: Promise<void>;
  /** Output waiting for the next batch to the renderer. */
  pending: string;
  flushTimer?: ReturnType<typeof setTimeout>;
  /** Characters sent to the renderer that it hasn't acknowledged drawing yet. */
  unacked: number;
  /** Whether the process is paused because the renderer is behind. */
  paused: boolean;
  /** For terminals spawned with `trackActivity`. */
  activity?: ActivityTracker;
}

export class TerminalManager {
  private readonly terminals = new Map<string, Terminal>();

  constructor(
    private readonly spawnPty: SpawnPty,
    private readonly onExit: (exit: TerminalExit) => void,
    private readonly onActivity: (sessionId: string, signal: ActivitySignal) => void = () => {},
  ) {}

  get size(): number {
    return this.terminals.size;
  }

  spawn({ sessionId, file, args, cwd, env, cols, rows, trackActivity }: SpawnParams): {
    pid: number;
  } {
    if (this.terminals.has(sessionId)) {
      throw new Error(`Terminal ${sessionId} already exists`);
    }
    const pty = this.spawnPty(file, args, {
      // Sets TERM on macOS; ignored on Windows, where ConPTY does the translation.
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
    const terminal: Terminal = {
      pty,
      mirror: new ScreenMirror(cols, rows),
      pending: '',
      unacked: 0,
      paused: false,
    };
    this.terminals.set(sessionId, terminal);
    if (trackActivity) {
      const activity = new ActivityTracker((signal) => this.onActivity(sessionId, signal));
      terminal.activity = activity;
      terminal.mirror.onBell(() => activity.bell());
    }

    pty.onData((data) => {
      terminal.mirror.write(data);
      terminal.activity?.output();
      if (!terminal.port) {
        return;
      }
      terminal.pending += data;
      terminal.flushTimer ??= setTimeout(() => flush(terminal), OUTPUT_BATCH_MS);
      updateFlow(terminal);
    });
    pty.onExit(({ exitCode, signal }) => {
      this.terminals.delete(sessionId);
      terminal.activity?.dispose();
      // node-pty reports signal 0 when there was none.
      const exit = { sessionId, exitCode, signal: signal ? signal : null };
      const tellRenderer = (): void => {
        flush(terminal);
        if (terminal.port) {
          terminal.port.postMessage({ type: 'exit', exitCode: exit.exitCode, signal: exit.signal });
          terminal.port.close();
        }
        terminal.mirror.dispose();
      };
      // A renderer that is just attaching gets its screen first.
      if (terminal.replay) {
        void terminal.replay.then(tellRenderer);
      } else {
        tellRenderer();
      }
      this.onExit(exit);
    });
    return { pid: pty.pid };
  }

  /**
   * Connects a renderer to the terminal: the current screen is sent first, then everything new.
   * A terminal has one connection; attaching again (e.g. after a UI reload) replaces it.
   * Messages from the renderer are untrusted and dropped unless well-formed.
   */
  attach(sessionId: string, port: TerminalPort): void {
    const terminal = this.get(sessionId);
    const previous = terminal.port;
    // The screen sent below includes anything still waiting for a batch.
    resetFlow(terminal);
    terminal.port = port;
    previous?.close();

    port.on('message', ({ data }) => {
      const message = parseTerminalClientMessage(data);
      if (!message || terminal.port !== port) {
        return;
      }
      switch (message.type) {
        case 'input':
          terminal.activity?.input();
          terminal.pty.write(message.data);
          break;
        case 'resize':
          resize(terminal, message.cols, message.rows);
          break;
        case 'ack':
          terminal.unacked = Math.max(0, terminal.unacked - message.chars);
          updateFlow(terminal);
          break;
      }
    });
    port.on('close', () => {
      if (terminal.port === port) {
        terminal.port = undefined;
        // Nobody is drawing: let the process run; the mirror keeps the screen.
        resetFlow(terminal);
        updateFlow(terminal);
      }
    });
    port.start();

    // Output that arrives from now on waits in `pending` until the screen has been sent.
    const replay = terminal.mirror.snapshot().then((screen) => {
      if (terminal.replay === replay) {
        terminal.replay = undefined;
      }
      if (terminal.port !== port) {
        return; // replaced or closed meanwhile
      }
      if (screen) {
        port.postMessage({ type: 'data', data: screen });
        terminal.unacked += screen.length;
      }
      if (terminal.pending) {
        terminal.flushTimer ??= setTimeout(() => flush(terminal), OUTPUT_BATCH_MS);
      }
      updateFlow(terminal);
    });
    terminal.replay = replay;
  }

  write(sessionId: string, data: string): void {
    const terminal = this.get(sessionId);
    terminal.activity?.input();
    terminal.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    resize(this.get(sessionId), cols, rows);
  }

  /** The current screen, as escape sequences (output still being parsed is not included). */
  output(sessionId: string): string {
    return this.get(sessionId).mirror.serialize();
  }

  /** Closes the terminal. Its `exit` is reported once the process has ended. */
  kill(sessionId: string): void {
    this.get(sessionId).pty.kill();
  }

  killAll(): void {
    for (const { pty } of this.terminals.values()) {
      try {
        pty.kill();
      } catch {
        // Already gone.
      }
    }
  }

  /** Whether a renderer is connected (for tests and diagnostics). */
  isAttached(sessionId: string): boolean {
    return this.terminals.get(sessionId)?.port !== undefined;
  }

  /** Whether the process is paused because the renderer is behind (for tests and diagnostics). */
  isPaused(sessionId: string): boolean {
    return this.terminals.get(sessionId)?.paused ?? false;
  }

  list(): { sessionId: string; pid: number }[] {
    return [...this.terminals].map(([sessionId, { pty }]) => ({ sessionId, pid: pty.pid }));
  }

  private get(sessionId: string): Terminal {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      throw new Error(`No running terminal ${sessionId}`);
    }
    return terminal;
  }
}

function resize(terminal: Terminal, cols: number, rows: number): void {
  terminal.pty.resize(cols, rows);
  terminal.mirror.resize(cols, rows);
}

/** Sends the waiting output as one message (V1 doc §11 "Back-pressure"). */
function flush(terminal: Terminal): void {
  clearTimeout(terminal.flushTimer);
  terminal.flushTimer = undefined;
  if (terminal.replay) {
    return; // sent once the screen has gone out
  }
  if (!terminal.pending || !terminal.port) {
    terminal.pending = '';
    return;
  }
  const data = terminal.pending;
  terminal.pending = '';
  terminal.unacked += data.length;
  terminal.port.postMessage({ type: 'data', data });
}

/** Forgets output in flight to the current renderer, e.g. when it is replaced. */
function resetFlow(terminal: Terminal): void {
  clearTimeout(terminal.flushTimer);
  terminal.flushTimer = undefined;
  terminal.pending = '';
  terminal.unacked = 0;
}

/** Pauses the process while the renderer is too far behind; resumes it once it catches up. */
function updateFlow(terminal: Terminal): void {
  const behind = terminal.unacked + terminal.pending.length;
  if (!terminal.paused && behind > FLOW_HIGH_WATERMARK) {
    terminal.paused = true;
    terminal.pty.pause();
  } else if (terminal.paused && behind < FLOW_LOW_WATERMARK) {
    terminal.paused = false;
    terminal.pty.resume();
  }
}
