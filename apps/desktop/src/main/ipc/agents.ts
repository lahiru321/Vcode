import { getDatabase } from '../db';
import {
  agentDeps,
  createAgent,
  deleteAgent,
  detectAgent,
  listAgents,
  listProviders,
  toAgent,
  toAgentValidation,
  updateAgent,
  validateAgent,
} from '../agents';
import { handle } from './registry';

export function registerAgentHandlers(): void {
  handle('agents:list', ({ projectId }) => listAgents(getDatabase(), projectId).map(toAgent));
  handle('agents:create', (request) => toAgent(createAgent(getDatabase(), request)));
  handle('agents:update', (request) => toAgent(updateAgent(getDatabase(), request)));
  handle('agents:delete', ({ id }) => deleteAgent(getDatabase(), id));
  handle('agents:validate', async ({ id }) =>
    toAgentValidation(await validateAgent(agentDeps(), id)),
  );
  handle('agents:providers', () => listProviders());
  handle('agents:detect', (request) => detectAgent(agentDeps(), request));
}
