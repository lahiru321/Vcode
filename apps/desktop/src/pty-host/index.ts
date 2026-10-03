import type { HostLogLevel, HostMethod, HostMethods, HostToMain, MainToHost } from './protocol';

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
  ) => HostMethods[M]['result'] | Promise<HostMethods[M]['result']>;
};

const handlers: Handlers = {
  ping: () => ({ pid: process.pid, uptimeMs: Date.now() - startedAt }),
};

async function handleRequest(id: number, method: HostMethod, params: unknown): Promise<void> {
  const handler = handlers[method] as ((params: unknown) => unknown) | undefined;
  if (!handler) {
    send({ kind: 'response', id, ok: false, error: { message: `Unknown method: ${method}` } });
    return;
  }
  try {
    send({ kind: 'response', id, ok: true, result: await handler(params) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ kind: 'response', id, ok: false, error: { message } });
  }
}

function shutdown(): void {
  // P2-07: stop every terminal's process tree before exiting.
  log('info', 'shutting down');
  process.exit(0);
}

port.on('message', ({ data }: { data: MainToHost }) => {
  switch (data.kind) {
    case 'request':
      void handleRequest(data.id, data.method, data.params);
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
