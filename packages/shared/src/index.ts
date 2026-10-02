// Types, constants and IPC contracts shared by the main process, preload and renderer.
// The sandboxed preload imports values only from the zod-free '@agent-hub/shared/ipc/channels';
// type-only imports from here are fine there.

export const APP_NAME = 'AI Agent Hub';

export * from './domain';
export * from './ipc';
