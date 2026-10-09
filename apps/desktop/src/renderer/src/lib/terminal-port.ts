import { TERMINAL_PORT_MESSAGE } from '@vcode/shared';
import { invoke } from './ipc';

// Gets a terminal's MessagePort: `terminals:attach` makes main send it, and the preload passes
// it on as a window `message` event (ports can't cross the context bridge).
//
// Each attach has its own id. The same terminal can be attached twice in a row (React mounts
// views twice in dev; a view can remount): the PTY host keeps only the latest port, so an
// earlier one must never be handed to the newer view.

const ATTACH_TIMEOUT_MS = 10_000;
const waiting = new Map<string, (port: MessagePort) => void>();

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { source?: unknown; attachId?: unknown } | null;
  if (event.source !== window || data?.source !== TERMINAL_PORT_MESSAGE) {
    return;
  }
  const [port] = event.ports;
  const resolve = typeof data.attachId === 'string' ? waiting.get(data.attachId) : undefined;
  if (!port) {
    return;
  }
  if (!resolve) {
    port.close(); // nobody is waiting for it (e.g. the attach timed out)
    return;
  }
  waiting.delete(data.attachId as string);
  resolve(port);
});

/** Connects to a running terminal. The port carries TerminalHostMessage / TerminalClientMessage. */
export function openTerminalPort(terminalId: string): Promise<MessagePort> {
  const attachId = crypto.randomUUID();
  return new Promise<MessagePort>((resolve, reject) => {
    const fail = (error: unknown): void => {
      clearTimeout(timer);
      waiting.delete(attachId);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const timer = setTimeout(
      () => fail(new Error('The terminal did not connect in time.')),
      ATTACH_TIMEOUT_MS,
    );
    waiting.set(attachId, (port) => {
      clearTimeout(timer);
      resolve(port);
    });
    invoke('terminals:attach', { terminalId, attachId }).catch(fail);
  });
}
