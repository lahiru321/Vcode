import { APP_NAME } from '@vcode/shared';
import type { AppUpdater, UpdateInfo } from 'electron-updater';
import { broadcastEvent } from './ipc';
import { createLogger } from './logging';

// Auto-update (P8-04, V1 doc §11): the packaged app checks GitHub Releases (electron-builder.yml
// `publish`) shortly after start-up and every few hours, downloads a new version in the
// background, and installs it when the app next quits — or at once from the tray's "Restart to
// update", which goes through the usual quit confirmation. Only published releases count:
// the release workflow makes drafts.

const log = createLogger('updater');

/** Leave start-up alone first. */
export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

export interface UpdaterState {
  /** A downloaded version waiting for a restart, if any. */
  ready: string | null;
}

export interface Updater {
  state: () => UpdaterState;
  /** Quits (with the usual confirmation) and installs the downloaded version. */
  restartToUpdate: () => void;
  stop: () => void;
}

/**
 * Starts checking for updates with `updater` (electron-updater's `autoUpdater`). `onChange` is
 * called when an update is ready (e.g. to refresh the tray menu).
 */
export function startUpdater(updater: AppUpdater, onChange: () => void): Updater {
  let ready: string | null = null;
  updater.logger = {
    info: (message: unknown) => log.info(String(message)),
    warn: (message: unknown) => log.warn(String(message)),
    // Failures are logged once, from the 'error' event below.
    error: (message: unknown) => log.debug(String(message)),
    debug: (message: unknown) => log.debug(String(message)),
  };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  updater.on('update-downloaded', (info: UpdateInfo) => {
    ready = info.version;
    log.info({ version: info.version }, 'update downloaded; installs on the next restart');
    broadcastEvent('app:notice', {
      level: 'info',
      message: `${APP_NAME} ${info.version} is ready and installs when you restart ${APP_NAME}.`,
    });
    onChange();
  });
  // Offline, no release yet, GitHub unreachable: worth a log line, not a message.
  updater.on('error', (err: Error) => log.warn({ err }, 'update check failed'));

  const check = () => {
    // A failed check also emits 'error' (logged there).
    updater.checkForUpdates().catch(() => undefined);
  };
  const first = setTimeout(check, FIRST_CHECK_DELAY_MS);
  const every = setInterval(check, CHECK_INTERVAL_MS);

  return {
    state: () => ({ ready }),
    restartToUpdate: () => {
      if (ready) updater.quitAndInstall();
    },
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
