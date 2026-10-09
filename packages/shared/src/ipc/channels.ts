// Channel names only, with no zod import, so the sandboxed preload can allowlist channels
// without bundling the schemas. contracts.ts checks that every name here has a contract.

/** Request/response channels (renderer → main, `ipcRenderer.invoke`). */
export const INVOKE_CHANNELS = [
  'app:getInfo',
  'projects:list',
  'projects:get',
  'projects:create',
  'projects:update',
  'projects:delete',
  'agents:list',
  'agents:create',
  'agents:update',
  'agents:delete',
  'agents:validate',
  'agents:providers',
  'agents:detect',
  'credentials:list',
  'credentials:set',
  'credentials:delete',
  'terminals:list',
  'terminals:create',
  'terminals:attach',
  'terminals:stop',
  'terminals:restart',
  'terminals:close',
  'settings:get',
  'settings:set',
  'dialog:pickFolder',
] as const;

/** Push channels (main → renderer, `webContents.send`). */
export const EVENT_CHANNELS = ['app:notice', 'agent:status'] as const;

/**
 * Main → renderer, carrying a terminal's MessagePort (`webContents.postMessage` with a transfer
 * list). Not an event channel: the preload hands the port to the page with window.postMessage,
 * because ports can't cross the context bridge. The page sees it as a `message` event whose
 * data has `source: TERMINAL_PORT_MESSAGE`.
 */
export const TERMINAL_PORT_CHANNEL = 'terminal:port';
export const TERMINAL_PORT_MESSAGE = 'vcode:terminal-port';

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type EventChannel = (typeof EVENT_CHANNELS)[number];
