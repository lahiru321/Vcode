import { TERMINAL_PORT_CHANNEL } from '@vcode/shared';
import { MessageChannelMain } from 'electron';
import { getDatabase } from '../db';
import {
  attachTerminal,
  closeTerminal,
  createTerminal,
  listTerminals,
  restartTerminal,
  stopTerminal,
  terminalDeps,
  withAgents,
} from '../terminals';
import type { TerminalRow } from '../terminals/service';
import { handle } from './registry';

export function registerTerminalHandlers(): void {
  const view = (row: TerminalRow) => withAgents(getDatabase(), [row])[0]!;
  handle('terminals:list', ({ projectId }) =>
    withAgents(getDatabase(), listTerminals(getDatabase(), projectId)),
  );
  handle('terminals:create', async (request) =>
    view(await createTerminal(terminalDeps(), request)),
  );
  handle('terminals:stop', async ({ terminalId }) =>
    view(await stopTerminal(terminalDeps(), terminalId)),
  );
  handle('terminals:restart', async ({ terminalId }) =>
    view(await restartTerminal(terminalDeps(), terminalId)),
  );
  handle('terminals:close', ({ terminalId }) => closeTerminal(terminalDeps(), terminalId));

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
