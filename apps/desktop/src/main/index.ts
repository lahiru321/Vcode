import { join } from 'node:path';
import { APP_NAME } from '@agent-hub/shared';
import { app, BrowserWindow } from 'electron';

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
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
    },
  });

  window.once('ready-to-show', () => window.show());

  // electron-vite sets ELECTRON_RENDERER_URL to the Vite dev server in development.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

void app.whenReady().then(() => {
  createMainWindow();
});

// Close-to-tray (P7-02) and macOS window conventions (M-02) replace this later.
app.on('window-all-closed', () => {
  app.quit();
});
