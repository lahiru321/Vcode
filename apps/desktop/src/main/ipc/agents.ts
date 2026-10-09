import { getDatabase } from '../db';
import {
  agentDeps,
  createAgent,
  listAgents,
  toAgent,
  toAgentValidation,
  validateAgent,
} from '../agents';
import { handle } from './registry';

export function registerAgentHandlers(): void {
  handle('agents:list', ({ projectId }) => listAgents(getDatabase(), projectId).map(toAgent));
  handle('agents:create', (request) => toAgent(createAgent(getDatabase(), request)));
  handle('agents:validate', async ({ id }) =>
    toAgentValidation(await validateAgent(agentDeps(), id)),
  );
}
