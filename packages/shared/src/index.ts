// Types, constants and IPC contracts shared by the main process, preload and renderer.
// The sandboxed preload imports values only from the zod-free '@vcode/shared/ipc/channels';
// type-only imports from here are fine there.

export const APP_NAME = 'Vcode';
/** Windows AppUserModelID and, later, the installer's appId (P8). */
export const APP_ID = 'com.lahiru321.vcode';
/** Source and releases (About, update notes). */
export const APP_REPO_URL = 'https://github.com/lahiru321/Vcode';

export * from './domain';
export * from './slug';
export * from './ipc';
export * from './terminal-port';
