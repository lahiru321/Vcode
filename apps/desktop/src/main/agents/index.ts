import { app } from 'electron';
import { getDatabase } from '../db';
import { loadBaseEnvironment, prepareTerminalEnvironment } from '../terminals/environment';
import { adapterContext } from './run';
import type { AgentDeps } from './service';

export { createAgent, listAgents, toAgent, toAgentValidation, validateAgent } from './service';

/** The real dependencies of the agents service. */
export function agentDeps(): AgentDeps {
  return {
    db: getDatabase(),
    adapters: adapterContext,
    // Agents run in terminals, so they get a terminal's environment.
    environment: async () =>
      prepareTerminalEnvironment(await loadBaseEnvironment(), app.getVersion()),
  };
}
