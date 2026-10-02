import type { AgentHubApi } from '../../preload';

declare global {
  interface Window {
    agentHub: AgentHubApi;
  }
}
