import { TERMINAL_PORT_MESSAGE } from '@vcode/shared';
import { invoke } from './ipc';

// Gets a terminal's MessagePort: `terminals:attach` makes main send it, and the preload passes
// it on as a window `message` event (ports can't cross the context bridge).

const ATTACH_TIMEOUT_MS = 10_000;
const waiting = new Map<string, (port: MessagePort) => void>();

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { source?: unknown; terminalId?: unknown } | null;
  if (event.source !== window || data?.source !== TERMINAL_PORT_MESSAGE) {
    return;
  }
  const [port] = event.ports;
  const resolve = typeof data.terminalId === 'string' ? waiting.get(data.terminalId) : undefined;
  if (!port) {
    return;
  }
  if (!resolve) {
    port.close(); // nobody is waiting for it (e.g. the view was closed meanwhile)
    return;
  }
  waiting.delete(data.terminalId as string);
  resolve(port);
});

/** Connects to a running terminal. The port carries TerminalHostMessage / TerminalClientMessage. */
export function openTerminalPort(terminalId: string): Promise<MessagePort> {
  return new Promise<MessagePort>((resolve, reject) => {
    const fail = (error: unknown): void => {
      clearTimeout(timer);
      waiting.delete(terminalId);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const timer = setTimeout(
      () => fail(new Error('The terminal did not connect in time.')),
      ATTACH_TIMEOUT_MS,
    );
    waiting.set(terminalId, (port) => {
      clearTimeout(timer);
      resolve(port);
    });
    invoke('terminals:attach', { terminalId }).catch(fail);
  });
}
