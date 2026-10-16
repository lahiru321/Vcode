// Stands in for the `electron` module in unit tests (vitest.config.ts aliases it here); nothing
// in the app imports this file. Unit tests run in plain Node, and since Electron 44.8 requiring
// the real package downloads the binary if it's missing, which CI's unit-test job skips and
// parallel test files race on. Tests that need behaviour still use `vi.mock('electron', …)`.

const notInTests = (name: string) => () => {
  throw new Error(`electron.${name} is not available in unit tests; vi.mock('electron') it`);
};

export const app = {};
export const BrowserWindow = { getAllWindows: () => [], fromWebContents: () => null };
export const clipboard = {};
export const contextBridge = {};
export const dialog = {};
export const ipcMain = {};
export const ipcRenderer = {};
export const MessageChannelMain = notInTests('MessageChannelMain');
export const Menu = {};
export const nativeImage = {};
export const Notification = notInTests('Notification');
export const safeStorage = {};
export const screen = {};
export const session = {};
export const shell = {};
export const Tray = notInTests('Tray');
export const utilityProcess = {};
