import { TERMINAL_PORT_CHANNEL } from '@vcode/shared';
import { MessageChannelMain } from 'electron';
import { getDatabase } from '../db';
import { attachTerminal, createTerminal, listTerminals, terminalDeps } from '../terminals';
import { handle } from './registry';

export function registerTerminalHandlers(): void {
  handle('terminals:list', ({ projectId }) => listTerminals(getDatabase(), projectId));
  handle('terminals:create', (request) => createTerminal(terminalDeps(), request));

  // One end of a new channel goes to the PTY host, the other to the window that asked (and
  // only to it): terminal data then flows between them without passing through main.
  handle('terminals:attach', async ({ terminalId, attachId }, { sender }) => {
    const { port1: hostPort, port2: rendererPort } = new MessageChannelMain();
    try {
      await attachTerminal(terminalDeps(), terminalId, hostPort);
    } catch (error) {
      rendererPort.close();
      throw error;
    }
    sender.postMessage(TERMINAL_PORT_CHANNEL, { attachId }, [rendererPort]);
    return { terminalId };
  });
}
