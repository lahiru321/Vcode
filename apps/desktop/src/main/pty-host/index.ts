import { join } from 'node:path';
import { APP_NAME } from '@vcode/shared';
import { utilityProcess, type MessagePortMain } from 'electron';
import { createLogger } from '../logging';
import { PtyHostSupervisor, type HostProcess } from './supervisor';

export { PtyHostError, type HostExit, type HostState, type TerminalExit } from './supervisor';

const log = createLogger('pty-host');

// Built by electron-vite next to the main bundle (see electron.vite.config.ts).
const HOST_ENTRY = join(__dirname, 'pty-host.js');

/** Logs each line the host prints (e.g. native crash output that never reached `log`). */
function logLines(stream: NodeJS.ReadableStream | null, level: 'info' | 'warn'): void {
  let buffered = '';
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk: string) => {
    const lines = (buffered + chunk).split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) {
        log[level]({ stream: level === 'info' ? 'stdout' : 'stderr' }, line);
      }
    }
  });
}

function forkHost(): HostProcess {
  const child = utilityProcess.fork(HOST_ENTRY, [], {
    serviceName: `${APP_NAME} PTY Host`,
    stdio: 'pipe',
  });
  logLines(child.stdout, 'info');
  logLines(child.stderr, 'warn');
  return {
    get pid() {
      return child.pid;
    },
    postMessage: (message, transfer) =>
      child.postMessage(message, transfer as MessagePortMain[] | undefined),
    kill: () => child.kill(),
    on(event: 'message' | 'exit', listener: (value: never) => void) {
      child.on(event as 'exit', listener as (code: number) => void);
      return this;
    },
  };
}

/** The app's one PTY host. Call `ptyHost.start()` once the app is ready. */
export const ptyHost = new PtyHostSupervisor({ fork: forkHost, log });
