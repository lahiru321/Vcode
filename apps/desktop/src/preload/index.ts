import { contextBridge } from 'electron';

// The only bridge between the sandboxed renderer and the main process.
// Typed IPC channels are added in P1-06.
const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
};

export type AgentHubApi = typeof api;

contextBridge.exposeInMainWorld('agentHub', api);
