// Types, constants and IPC contracts shared by the main process, preload and renderer.
// The sandboxed preload imports values only from the zod-free '@vcode/shared/ipc/channels';
// type-only imports from here are fine there.

export const APP_NAME = 'Vcode';

export * from './domain';
export * from './ipc';
