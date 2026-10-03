import { parseTerminalClientMessage, type TerminalHostMessage } from '@vcode/shared/terminal-port';
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
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

/** Recent output kept per terminal until the screen mirror (P2-06) replaces it. */
const MAX_BUFFERED_OUTPUT = 256 * 1024;

interface Terminal {
  pty: IPty;
  output: string;
  /** The renderer's connection, if one is attached. */
  port?: TerminalPort;
}

export class TerminalManager {
  private readonly terminals = new Map<string, Terminal>();

  constructor(
    private readonly spawnPty: SpawnPty,
    private readonly onExit: (exit: TerminalExit) => void,
  ) {}

  get size(): number {
    return this.terminals.size;
  }

  spawn({ sessionId, file, args, cwd, env, cols, rows }: SpawnParams): { pid: number } {
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
    const terminal: Terminal = { pty, output: '' };
    this.terminals.set(sessionId, terminal);

    pty.onData((data) => {
      terminal.output += data;
      if (terminal.output.length > MAX_BUFFERED_OUTPUT) {
        terminal.output = terminal.output.slice(-MAX_BUFFERED_OUTPUT);
      }
      terminal.port?.postMessage({ type: 'data', data });
    });
    pty.onExit(({ exitCode, signal }) => {
      this.terminals.delete(sessionId);
      // node-pty reports signal 0 when there was none.
      const exit = { sessionId, exitCode, signal: signal ? signal : null };
      if (terminal.port) {
        terminal.port.postMessage({ type: 'exit', exitCode: exit.exitCode, signal: exit.signal });
        terminal.port.close();
      }
      this.onExit(exit);
    });
    return { pid: pty.pid };
  }

  /**
   * Connects a renderer to the terminal: recent output is sent first, then everything new.
   * A terminal has one connection; attaching again (e.g. after a UI reload) replaces it.
   * Messages from the renderer are untrusted and dropped unless well-formed.
   */
  attach(sessionId: string, port: TerminalPort): void {
    const terminal = this.get(sessionId);
    terminal.port?.close();
    terminal.port = port;

    port.on('message', ({ data }) => {
      const message = parseTerminalClientMessage(data);
      if (!message || terminal.port !== port) {
        return;
      }
      if (message.type === 'input') {
        terminal.pty.write(message.data);
      } else {
        terminal.pty.resize(message.cols, message.rows);
      }
    });
    port.on('close', () => {
      if (terminal.port === port) {
        terminal.port = undefined;
      }
    });
    port.start();
    if (terminal.output) {
      port.postMessage({ type: 'data', data: terminal.output });
    }
  }

  write(sessionId: string, data: string): void {
    this.get(sessionId).pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.get(sessionId).pty.resize(cols, rows);
  }

  output(sessionId: string): string {
    return this.get(sessionId).output;
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
