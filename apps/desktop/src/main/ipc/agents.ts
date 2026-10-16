import { recordAudit } from '../audit/service';
import { getDatabase } from '../db';
import {
  agentDeps,
  createAgent,
  deleteAgent,
  detectAgent,
  getAgent,
  listAgents,
  listProviders,
  toAgent,
  toAgentValidation,
  updateAgent,
  validateAgent,
} from '../agents';
import { listActiveAgentSessions } from '../agents/sessions';
import { handle } from './registry';

export function registerAgentHandlers(): void {
  handle('agents:list', ({ projectId }) => listAgents(getDatabase(), projectId).map(toAgent));
  handle('agents:create', (request) => {
    const row = createAgent(getDatabase(), request);
    recordAudit(getDatabase(), {
      projectId: row.projectId,
      action: 'agent.create',
      resourceType: 'agent',
      resourceId: row.id,
      metadata: { name: row.name, adapter: row.adapter },
    });
    return toAgent(row);
  });
  handle('agents:update', (request) => {
    const row = updateAgent(getDatabase(), request);
    // Which settings changed, not their values: arguments and variables can hold secrets.
    const changed = Object.keys(request)
      .filter((key) => key !== 'id')
      .sort()
      .join(', ');
    recordAudit(getDatabase(), {
      projectId: row.projectId,
      action: 'agent.update',
      resourceType: 'agent',
      resourceId: row.id,
      metadata: { name: row.name, changed },
    });
    return toAgent(row);
  });
  handle('agents:delete', ({ id }) => {
    const before = getAgent(getDatabase(), id);
    const result = deleteAgent(getDatabase(), id);
    recordAudit(getDatabase(), {
      projectId: before.projectId,
      action: 'agent.delete',
      resourceType: 'agent',
      resourceId: id,
      metadata: { name: before.name, adapter: before.adapter },
    });
    return result;
  });
  handle('agents:validate', async ({ id }) =>
    toAgentValidation(await validateAgent(agentDeps(), id)),
  );
  handle('agents:providers', () => listProviders());
  handle('agents:detect', (request) => detectAgent(agentDeps(), request));
  handle('agents:sessions', () => listActiveAgentSessions(getDatabase()));
}
