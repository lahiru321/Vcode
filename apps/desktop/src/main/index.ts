import { arch, release, type } from 'node:os';
import { join } from 'node:path';
import { APP_NAME } from '@vcode/shared';
import { app, BrowserWindow, dialog } from 'electron';
import { closeDatabase, initDatabase } from './db';
import { broadcastEvent, registerIpcHandlers } from './ipc';
import { closeLogging, createLogger, initLogging, levelFromEnv } from './logging';
import { ptyHost } from './pty-host';
import { loadRenderer } from './renderer';
import { applySecurityBaseline } from './security';
import { loadWindowState, trackWindowState } from './window-state';

const log = createLogger('app');

startLogging();
applySecurityBaseline();

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
  createMainWindow();
});

function startPtyHost(): void {
  ptyHost.on('failed', () =>
    broadcastEvent('app:notice', {
      level: 'error',
      message: `Terminals are unavailable: the terminal host keeps crashing. Restart ${APP_NAME} to try again.`,
    }),
  );
  ptyHost.start();
}

// Let the PTY host stop its terminals before the app exits (it gets a few seconds).
app.on('before-quit', (event) => {
  if (ptyHost.state === 'idle' || ptyHost.state === 'stopped') {
    return;
  }
  event.preventDefault();
  void ptyHost.stop().finally(() => app.quit());
});

app.on('will-quit', () => {
  closeDatabase();
  log.info('quitting');
  closeLogging();
});

// Close-to-tray (P7-02) and macOS window conventions (M-02) replace this later.
app.on('window-all-closed', () => {
  app.quit();
});
