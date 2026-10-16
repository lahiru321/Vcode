import { arch, release, type } from 'node:os';
import { join } from 'node:path';
import { APP_ID, APP_NAME } from '@vcode/shared';
import { app, BrowserWindow, dialog } from 'electron';
import { closeDatabase, initDatabase } from './db';
import { broadcastEvent, registerIpcHandlers } from './ipc';
import { APP_ICON_PATH } from './icon';
import { closeLogging, createLogger, initLogging, levelFromEnv } from './logging';
import { startNotifications } from './notifications';
import { platform } from './platform';
import { ptyHost } from './pty-host';
import { allowQuit, handleWindowClose, quitNow } from './quit';
import { loadRenderer } from './renderer';
import { applySecurityBaseline } from './security';
import { trackTerminalSessions } from './terminals';
import { createTray, type AppTray } from './tray';
import { loadWindowState, trackWindowState } from './window-state';

const log = createLogger('app');

startLogging();
applySecurityBaseline();
platform.setAppId(APP_ID);

function startLogging(): void {
  try {
    const file = initLogging({
      dir: app.getPath('logs'),
      level: levelFromEnv(app.isPackaged ? 'info' : 'debug'),
      console: !app.isPackaged,
    });
    log.info(
      {
        version: app.getVersion(),
        electron: process.versions.electron,
        os: `${type()} ${release()} ${arch()}`,
        file,
      },
      `${APP_NAME} starting`,
    );
  } catch (error) {
    // The app works without a log file; say so where it can still be seen.
    console.error('Could not start logging:', error);
  }

  // Monitor only: Electron's default crash handling still runs.
  process.on('uncaughtExceptionMonitor', (err) => log.fatal({ err }, 'uncaught exception'));
  process.on('unhandledRejection', (reason) => log.error({ err: reason }, 'unhandled rejection'));
  app.on('render-process-gone', (_event, _contents, details) =>
    log.error({ details }, 'renderer process gone'),
  );
  app.on('child-process-gone', (_event, details) => log.error({ details }, 'child process gone'));
}

const WINDOW_SIZE = { width: 1280, height: 800, minWidth: 900, minHeight: 600 };

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;

function createMainWindow(): BrowserWindow {
  const state = loadWindowState(WINDOW_SIZE);
  const window = new BrowserWindow({
    ...state.bounds,
    minWidth: WINDOW_SIZE.minWidth,
    minHeight: WINDOW_SIZE.minHeight,
    show: false,
    title: APP_NAME,
    icon: APP_ICON_PATH,
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
  window.on('close', (event) => handleWindowClose(event, window, tray !== null));
  window.on('session-end', quitNow);
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  // Renderer warnings and errors (e.g. CSP violations) go to the log, and the dev terminal.
  const rendererLog = createLogger('renderer');
  window.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    if (level === 'warning' || level === 'error') {
      rendererLog[level === 'error' ? 'error' : 'warn'](
        { source: `${sourceId}:${lineNumber}` },
        message,
      );
    }
  });

  void loadRenderer(window);

  return window;
}

void app.whenReady().then(() => {
  try {
    initDatabase(app.getPath('userData'));
  } catch (error) {
    log.fatal({ err: error }, 'could not open the database');
    dialog.showErrorBox(
      `${APP_NAME} can't start`,
      `The local database could not be opened.

${error instanceof Error ? error.message : String(error)}`,
    );
    app.exit(1);
    return;
  }

  registerIpcHandlers();
  startPtyHost();
  mainWindow = createMainWindow();
  startTray(mainWindow);
  startNotifications(() => mainWindow);
});

function startTray(window: BrowserWindow): void {
  try {
    tray = createTray(
      () => mainWindow,
      () => app.quit(),
    );
    tray.watchWindow(window);
  } catch (err) {
    // The app works without a tray icon (e.g. a Linux desktop without a status area).
    log.error({ err }, 'could not create the tray icon');
  }
}

function startPtyHost(): void {
  ptyHost.on('failed', () =>
    broadcastEvent('app:notice', {
      level: 'error',
      message: `Terminals are unavailable: the terminal host keeps crashing. Restart ${APP_NAME} to try again.`,
    }),
  );
  trackTerminalSessions();
  ptyHost.start();
}

// Quitting with agents running asks first (P7-02). Then the PTY host stops its terminals
// before the app exits (it gets a few seconds).
app.on('before-quit', (event) => {
  if (!allowQuit(mainWindow)) {
    event.preventDefault();
    return;
  }
  if (ptyHost.state === 'idle' || ptyHost.state === 'stopped') {
    return;
  }
  event.preventDefault();
  void ptyHost.stop().finally(() => app.quit());
});

app.on('will-quit', () => {
  tray?.destroy();
  closeDatabase();
  log.info('quitting');
  closeLogging();
});

// Only reached once a quit is under way (the window hides instead of closing otherwise);
// macOS window conventions (M-02) change this later.
app.on('window-all-closed', () => {
  app.quit();
});
