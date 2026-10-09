import { spawn } from 'node-pty';
import type { HostLogLevel, HostMethod, HostMethods, HostToMain, MainToHost } from './protocol';
import { TerminalManager, type TerminalPort } from './terminals';

// PTY host entry: an Electron utility process that will own every pseudo-terminal (V1 doc §11),
// so a busy or crashing terminal can't freeze the UI or main. Main starts it, restarts it if it
// dies (src/main/pty-host), and talks to it with the messages in ./protocol.

const port = process.parentPort;
const startedAt = Date.now();

function send(message: HostToMain): void {
  port.postMessage(message);
}

/** Logs through main, so host records end up in the same log file. */
function log(level: HostLogLevel, msg: string, data?: Record<string, unknown>): void {
  send({ kind: 'log', level, msg, data });
}

type Handlers = {
  [M in HostMethod]: (
    params: HostMethods[M]['params'],
    /** MessagePorts transferred with the request. */
    ports: TerminalPort[],
  ) => HostMethods[M]['result'] | Promise<HostMethods[M]['result']>;
};

const terminals = new TerminalManager(
  spawn,
  (exit) => send({ kind: 'exit', ...exit }),
  (sessionId, signal) => send({ kind: 'activity', sessionId, signal }),
);

const handlers: Handlers = {
  ping: () => ({ pid: process.pid, uptimeMs: Date.now() - startedAt }),
  spawn: (params) => terminals.spawn(params),
  write: ({ sessionId, data }) => {
    terminals.write(sessionId, data);
    return null;
  },
  resize: ({ sessionId, cols, rows }) => {
    terminals.resize(sessionId, cols, rows);
    return null;
  },
  attach: ({ sessionId }, [port]) => {
    if (!port) {
      throw new Error('attach needs a MessagePort');
    }
    terminals.attach(sessionId, port);
    return null;
  },
  kill: ({ sessionId }) => {
    terminals.kill(sessionId);
    return null;
  },
  output: ({ sessionId }) => ({ data: terminals.output(sessionId) }),
  list: () => ({ sessions: terminals.list() }),
};

async function handleRequest(
  id: number,
  method: HostMethod,
  params: unknown,
  ports: TerminalPort[],
): Promise<void> {
  const handler = handlers[method] as
    ((params: unknown, ports: TerminalPort[]) => unknown) | undefined;
  if (!handler) {
    send({ kind: 'response', id, ok: false, error: { message: `Unknown method: ${method}` } });
    return;
  }
  try {
    send({ kind: 'response', id, ok: true, result: await handler(params, ports) });
  } catch (error) {
    for (const port of ports) {
      port.close();
    }
    const message = error instanceof Error ? error.message : String(error);
    send({ kind: 'response', id, ok: false, error: { message } });
  }
}

/** How long shutdown waits for terminals to report their exit. */
const SHUTDOWN_GRACE_MS = 2_000;

function shutdown(): void {
  log('info', 'shutting down', { terminals: terminals.size });
  // Closing a pseudo-terminal ends the processes attached to its console. Processes that
  // detached from it are handled by tree kill (P2-07) and orphan cleanup (P2-09).
  terminals.killAll();
  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  const timer = setInterval(() => {
    if (terminals.size === 0 || Date.now() > deadline) {
      clearInterval(timer);
      process.exit(0);
    }
  }, 25);
}

port.on('message', ({ data, ports = [] }: { data: MainToHost; ports?: TerminalPort[] }) => {
  switch (data.kind) {
    case 'request':
      void handleRequest(data.id, data.method, data.params, ports);
      break;
    case 'shutdown':
      shutdown();
      break;
  }
});

// An unexpected error leaves the host in an unknown state: report it and exit, and main
// starts a fresh host. stderr is captured by main too, in case the message can't be sent.
process.on('uncaughtException', (error) => {
  console.error(error);
  try {
    log('error', 'uncaught exception', { message: error.message, stack: error.stack });
  } finally {
    process.exit(1);
  }
});

send({ kind: 'ready', pid: process.pid });
