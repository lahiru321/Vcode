import { TERMINAL_PORT_CHANNEL } from '@vcode/shared';
import { MessageChannelMain } from 'electron';
import { recordAudit, workspaceContext } from '../audit/service';
import { getDatabase } from '../db';
import {
  attachTerminal,
  closeTerminal,
  createTerminal,
  getTerminal,
  listTerminals,
  renameTerminal,
  restartTerminal,
  stopTerminal,
  terminalDeps,
  withAgents,
} from '../terminals';
import type { TerminalRow } from '../terminals/service';
import { handle } from './registry';

/** `agent.start` for a terminal that runs an agent, else `terminal.start`. */
function auditStart(row: TerminalRow, restarted: boolean): void {
  const db = getDatabase();
  const { projectId, workspace } = workspaceContext(db, row.workspaceId);
  const agent = withAgents(db, [row])[0]?.agent;
  recordAudit(db, {
    projectId,
    action: agent ? 'agent.start' : 'terminal.start',
    resourceType: agent ? 'agent_session' : 'terminal',
    resourceId: agent ? agent.sessionId : row.id,
    metadata: {
      ...(agent ? { agent: agent.name } : { shell: row.shell }),
      title: row.title,
      workspace,
      cwd: row.cwd,
      restarted: restarted || undefined,
    },
  });
}

/**
 * `terminal.stop` when a running shell is stopped or closed. An agent's terminal isn't: its run
 * ending is recorded as `agent.end` (audit/service.ts).
 */
function auditStop(before: TerminalRow): void {
  if (before.agentSessionId || (before.status !== 'running' && before.status !== 'starting')) {
    return;
  }
  const db = getDatabase();
  const { projectId, workspace } = workspaceContext(db, before.workspaceId);
  recordAudit(db, {
    projectId,
    action: 'terminal.stop',
    resourceType: 'terminal',
    resourceId: before.id,
    metadata: { title: before.title, workspace },
  });
}

export function registerTerminalHandlers(): void {
  const view = (row: TerminalRow) => withAgents(getDatabase(), [row])[0]!;
  handle('terminals:list', ({ projectId }) =>
    withAgents(getDatabase(), listTerminals(getDatabase(), projectId)),
  );
  handle('terminals:create', async (request) => {
    const row = await createTerminal(terminalDeps(), request);
    auditStart(row, false);
    return view(row);
  });
  handle('terminals:stop', async ({ terminalId }) => {
    const before = getTerminal(getDatabase(), terminalId);
    const row = await stopTerminal(terminalDeps(), terminalId);
    auditStop(before);
    return view(row);
  });
  handle('terminals:restart', async ({ terminalId }) => {
    const before = getTerminal(getDatabase(), terminalId);
    const row = await restartTerminal(terminalDeps(), terminalId);
    auditStop(before);
    auditStart(row, true);
    return view(row);
  });
  handle('terminals:rename', ({ terminalId, title }) =>
    view(renameTerminal(getDatabase(), terminalId, title)),
  );
  handle('terminals:close', async ({ terminalId }) => {
    const before = getTerminal(getDatabase(), terminalId);
    const result = await closeTerminal(terminalDeps(), terminalId);
    auditStop(before);
    return result;
  });

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
