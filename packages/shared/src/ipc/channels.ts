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
  'terminals:list',
  'terminals:create',
  'settings:get',
  'settings:set',
  'dialog:pickFolder',
] as const;

/** Push channels (main → renderer, `webContents.send`). */
export const EVENT_CHANNELS = ['app:notice'] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type EventChannel = (typeof EVENT_CHANNELS)[number];
