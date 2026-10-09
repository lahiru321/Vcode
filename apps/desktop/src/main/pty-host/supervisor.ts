import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import {
  HostToMain,
  type HostMethod,
  type HostParams,
  type HostResult,
  type MainToHost,
} from '../../pty-host/protocol';

// Starts the PTY host utility process and keeps it running (V1 doc §11 "Crash safety"): if it
// exits unexpectedly it is restarted with a growing delay, and if it keeps crashing the
// supervisor gives up and reports `failed`. Electron is reached only through `fork`, so the
// logic can be unit-tested with a fake process.

/** The parts of Electron's UtilityProcess the supervisor uses. */
export interface HostProcess {
  readonly pid: number | undefined;
  /** `transfer`: MessagePorts handed over with the message. */
  postMessage(message: MainToHost, transfer?: readonly unknown[]): void;
  kill(): boolean;
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
}

export type HostState =
  'idle' | 'starting' | 'ready' | 'restarting' | 'stopping' | 'stopped' | 'failed';

export interface SupervisorOptions {
  fork: () => HostProcess;
  log: Logger;
  /** How long a new host may take to report `ready`. */
  readyTimeoutMs?: number;
  /** Delays before each restart; the last one repeats. */
  restartDelaysMs?: readonly number[];
  /** Give up after this many crashes within `crashWindowMs`. */
  maxCrashes?: number;
  crashWindowMs?: number;
  /** How long `stop()` waits for a clean exit before killing the host. */
  stopTimeoutMs?: number;
  /** Default timeout for `request()`. */
  requestTimeoutMs?: number;
  now?: () => number;
}

export interface HostExit {
  code: number;
  /** False for a crash; P2-08 marks the affected sessions FAILED. */
  expected: boolean;
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface TerminalExit {
  sessionId: string;
  exitCode: number;
  signal: number | null;
}

interface SupervisorEvents {
  ready: [pid: number];
  exit: [exit: HostExit];
  failed: [];
  /** A terminal's process ended. */
  terminalExit: [exit: TerminalExit];
  /** Output / idle / bell of a terminal spawned with `trackActivity`. */
  terminalActivity: [activity: TerminalActivity];
}

export interface TerminalActivity {
  sessionId: string;
  signal: 'output' | 'idle' | 'bell';
}

/**
 * - `unavailable`: the host isn't running, or stopped before answering.
 * - `timeout`: no answer in time.
 * - `failed`: the host answered with an error (e.g. the process couldn't be started).
 */
export type PtyHostErrorReason = 'unavailable' | 'timeout' | 'failed';

export class PtyHostError extends Error {
  override readonly name = 'PtyHostError';

  constructor(
    readonly reason: PtyHostErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export class PtyHostSupervisor extends EventEmitter<SupervisorEvents> {
  private readonly options: Required<Omit<SupervisorOptions, 'fork' | 'log'>>;
  private readonly fork: () => HostProcess;
  private readonly log: Logger;

  private host: HostProcess | undefined;
  private hostPid: number | undefined;
  private currentState: HostState = 'idle';
  private readyTimer: NodeJS.Timeout | undefined;
  private restartTimer: NodeJS.Timeout | undefined;
  private crashTimes: number[] = [];
  private restartCount = 0;
  private nextRequestId = 1;
  private readonly pending = new Map<number, Pending>();
  private stopPromise: Promise<void> | undefined;

  constructor({ fork, log, ...options }: SupervisorOptions) {
    super();
    this.fork = fork;
    this.log = log;
    this.options = {
      readyTimeoutMs: 10_000,
      restartDelaysMs: [250, 1_000, 2_000, 5_000],
      maxCrashes: 5,
      crashWindowMs: 60_000,
      stopTimeoutMs: 3_000,
      requestTimeoutMs: 10_000,
      now: Date.now,
      ...options,
    };
  }

  get state(): HostState {
    return this.currentState;
  }

  /** PID of the running host, once it has reported ready. */
  get pid(): number | undefined {
    return this.currentState === 'ready' ? this.hostPid : undefined;
  }

  /** Starts the host. It is then kept running until stop(). */
  start(): void {
    if (this.currentState !== 'idle') {
      throw new Error(`PTY host already started (state: ${this.currentState})`);
    }
    this.spawn();
  }

  /**
   * Calls a host method. Rejects with PtyHostError if the host isn't ready, fails or exits.
   * `transfer`: MessagePorts to hand over with the request (e.g. for `attach`).
   */
  request<M extends HostMethod>(
    method: M,
    params: HostParams<M>,
    {
      timeoutMs = this.options.requestTimeoutMs,
      transfer,
    }: { timeoutMs?: number; transfer?: readonly unknown[] } = {},
  ): Promise<HostResult<M>> {
    const host = this.host;
    if (!host || this.currentState !== 'ready') {
      return Promise.reject(
        new PtyHostError('unavailable', `The terminal host is not running (${this.currentState}).`),
      );
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new PtyHostError('timeout', `The terminal host did not answer "${method}" in time.`),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject, timer });
      host.postMessage({ kind: 'request', id, method, params }, transfer);
    });
  }

  /** Asks the host to stop its terminals and exit; kills it if it doesn't. No restarts after. */
  stop(): Promise<void> {
    this.stopPromise ??= this.stopHost();
    return this.stopPromise;
  }

  private async stopHost(): Promise<void> {
    clearTimeout(this.restartTimer);
    clearTimeout(this.readyTimer);
    const host = this.host;
    if (!host) {
      this.currentState = 'stopped';
      return;
    }
    this.currentState = 'stopping';
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.log.warn('PTY host did not exit in time; killing it');
        host.kill();
      }, this.options.stopTimeoutMs);
      host.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        host.postMessage({ kind: 'shutdown' });
      } catch {
        host.kill();
      }
    });
    this.currentState = 'stopped';
  }

  private spawn(): void {
    this.currentState = this.restartCount > 0 ? 'restarting' : 'starting';
    let host: HostProcess;
    try {
      host = this.fork();
    } catch (err) {
      this.log.error({ err }, 'could not start the PTY host');
      this.handleExit(undefined, -1);
      return;
    }
    this.host = host;
    this.hostPid = undefined;

    host.on('message', (message) => this.handleMessage(host, message));
    host.on('exit', (code) => this.handleExit(host, code));

    this.readyTimer = setTimeout(() => {
      this.log.error({ timeoutMs: this.options.readyTimeoutMs }, 'PTY host did not become ready');
      host.kill(); // the exit handler counts this as a crash
    }, this.options.readyTimeoutMs);
  }

  private handleMessage(host: HostProcess, raw: unknown): void {
    if (host !== this.host) {
      return; // a late message from a host that was replaced
    }
    const parsed = HostToMain.safeParse(raw);
    if (!parsed.success) {
      this.log.warn(
        { issues: parsed.error.issues },
        'ignoring an invalid message from the PTY host',
      );
      return;
    }
    const message = parsed.data;
    switch (message.kind) {
      case 'ready':
        clearTimeout(this.readyTimer);
        this.hostPid = message.pid;
        if (this.currentState === 'starting' || this.currentState === 'restarting') {
          this.currentState = 'ready';
          this.log.info({ pid: message.pid, restarts: this.restartCount }, 'PTY host ready');
          this.emit('ready', message.pid);
        }
        break;
      case 'response': {
        const pending = this.pending.get(message.id);
        if (!pending) {
          return; // timed out already
        }
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(new PtyHostError('failed', message.error.message));
        }
        break;
      }
      case 'exit':
        this.emit('terminalExit', {
          sessionId: message.sessionId,
          exitCode: message.exitCode,
          signal: message.signal,
        });
        break;
      case 'activity':
        this.emit('terminalActivity', { sessionId: message.sessionId, signal: message.signal });
        break;
      case 'log':
        this.log[message.level](message.data ?? {}, message.msg);
        break;
    }
  }

  private handleExit(host: HostProcess | undefined, code: number): void {
    if (host && host !== this.host) {
      return;
    }
    clearTimeout(this.readyTimer);
    this.host = undefined;
    this.hostPid = undefined;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new PtyHostError('unavailable', 'The terminal host stopped.'));
      this.pending.delete(id);
    }

    const expected = this.currentState === 'stopping' || this.currentState === 'stopped';
    this.emit('exit', { code, expected });
    if (expected) {
      this.log.info({ code }, 'PTY host exited');
      return;
    }

    const now = this.options.now();
    this.crashTimes = [...this.crashTimes, now].filter(
      (time) => now - time < this.options.crashWindowMs,
    );
    if (this.crashTimes.length >= this.options.maxCrashes) {
      this.currentState = 'failed';
      this.log.fatal(
        { code, crashes: this.crashTimes.length, windowMs: this.options.crashWindowMs },
        'PTY host keeps crashing; not restarting it again',
      );
      this.emit('failed');
      return;
    }

    const delays = this.options.restartDelaysMs;
    const delay = delays[Math.min(this.crashTimes.length - 1, delays.length - 1)] ?? 0;
    this.currentState = 'restarting';
    this.log.error({ code, restartInMs: delay }, 'PTY host exited unexpectedly; restarting it');
    this.restartTimer = setTimeout(() => {
      this.restartCount++;
      this.spawn();
    }, delay);
  }
}
