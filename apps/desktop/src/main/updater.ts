import type { UpdateState } from '@vcode/shared';
import type { AppUpdater, UpdateInfo } from 'electron-updater';
import { broadcastEvent } from './ipc/registry';
import { createLogger } from './logging';

// Auto-update (P8-04, V1 doc §11): the packaged app checks GitHub Releases (electron-builder.yml
// `publish`) shortly after start-up and every few hours, downloads a new version in the
// background, and installs it when the app next quits — or at once from "Restart to update" (the
// status bar, the update toast, the tray), which reopens the app on the new version. Only
// published releases count: the release workflow makes drafts.

const log = createLogger('updater');

/** Leave start-up alone first. */
export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

export interface Updater {
  state: () => UpdateState;
  /**
   * Quits and installs the downloaded version silently, then starts it. Asks first when agents
   * are running: the installer must not start unless the app is really quitting.
   */
  restartToUpdate: () => Promise<void>;
  stop: () => void;
}

export interface UpdaterHooks {
  /** An update is ready (e.g. to refresh the tray menu). */
  onChange: () => void;
  /** True if the app may quit now (quit.ts `confirmQuit`). */
  confirmQuit: () => Promise<boolean>;
  /** Lets the quit that follows through without asking again (quit.ts `quitNow`). */
  quitNow: () => void;
}

let active: Updater | null = null;

/** The running updater; null in dev builds or if it could not start. */
export function activeUpdater(): Updater | null {
  return active;
}

/** Starts checking for updates with `updater` (electron-updater's `autoUpdater`). */
export function startUpdater(updater: AppUpdater, hooks: UpdaterHooks): Updater {
  let ready: string | null = null;
  let restarting = false;
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
    broadcastEvent('app:update', { ready });
    hooks.onChange();
  });
  // Offline, no release yet, GitHub unreachable: worth a log line, not a message.
  updater.on('error', (err: Error) => log.warn({ err }, 'update check failed'));

  const check = () => {
    // A failed check also emits 'error' (logged there).
    updater.checkForUpdates().catch(() => undefined);
  };
  const first = setTimeout(check, FIRST_CHECK_DELAY_MS);
  const every = setInterval(check, CHECK_INTERVAL_MS);

  const control: Updater = {
    state: () => ({ ready }),
    restartToUpdate: async () => {
      if (!ready || restarting) return;
      restarting = true;
      try {
        if (!(await hooks.confirmQuit())) return;
        log.info({ version: ready }, 'restarting to update');
        hooks.quitNow();
        // Silent, and start the new version afterwards.
        updater.quitAndInstall(true, true);
      } finally {
        restarting = false;
      }
    },
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
      if (active === control) active = null;
    },
  };
  active = control;
  return control;
}
