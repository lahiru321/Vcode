import { getDatabase } from '../db';
import { createTerminal, listTerminals, terminalDeps } from '../terminals';
import { handle } from './registry';

export function registerTerminalHandlers(): void {
  handle('terminals:list', ({ projectId }) => listTerminals(getDatabase(), projectId));
  handle('terminals:create', (request) => createTerminal(terminalDeps(), request));
}
