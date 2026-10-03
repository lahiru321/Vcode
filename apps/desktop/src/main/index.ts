import { join } from 'node:path';
import { APP_NAME } from '@vcode/shared';
import { app, BrowserWindow, dialog } from 'electron';
import { closeDatabase, initDatabase } from './db';
import { registerIpcHandlers } from './ipc';
import { loadRenderer } from './renderer';
import { applySecurityBaseline } from './security';
import { loadWindowState, trackWindowState } from './window-state';

applySecurityBaseline();

const WINDOW_SIZE = { width: 1280, height: 800, minWidth: 900, minHeight: 600 };

function createMainWindow(): BrowserWindow {
  const state = loadWindowState(WINDOW_SIZE);
  const window = new BrowserWindow({
    ...state.bounds,
    minWidth: WINDOW_SIZE.minWidth,
    minHeight: WINDOW_SIZE.minHeight,
    show: false,
    title: APP_NAME,
    // Matches the renderer's dark --background token to avoid a flash on load.
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  window.once('ready-to-show', () => {
    if (state.maximized) {
      window.maximize();
    }
    window.show();
  });
  trackWindowState(window);

  if (!app.isPackaged) {
    // Surface renderer warnings and errors (e.g. CSP violations) in the dev terminal.
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'warning' || level === 'error') {
        console.log(`[renderer:${level}] ${message}`);
      }
    });
  }

  void loadRenderer(window);

  return window;
}

void app.whenReady().then(() => {
  try {
    initDatabase(app.getPath('userData'));
  } catch (error) {
    console.error('[db] failed to open the database:', error);
    dialog.showErrorBox(
      `${APP_NAME} can't start`,
      `The local database could not be opened.

${error instanceof Error ? error.message : String(error)}`,
    );
    app.exit(1);
    return;
  }

  registerIpcHandlers();
  createMainWindow();
});

app.on('will-quit', () => {
  closeDatabase();
});

// Close-to-tray (P7-02) and macOS window conventions (M-02) replace this later.
app.on('window-all-closed', () => {
  app.quit();
});
