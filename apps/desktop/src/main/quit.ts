import { APP_NAME } from '@vcode/shared';
import { z } from 'zod';
import { app, dialog, Notification, type BrowserWindow, type MessageBoxOptions } from 'electron';
import { listRunningAgents, type RunningAgent } from './agents/sessions';
import { getDatabase } from './db';
import { createLogger } from './logging';
import { getSettings, readSetting, writeSetting } from './settings/store';
import { statusLabel } from './tray';

// Closing and quitting (P7-02, V1 doc §5). Closing the window hides it to the tray (a setting,
// on by default) while agents keep running. Quitting with agents running asks first, listing
// them, from wherever the quit came: the tray, the keyboard, or closing the window with the
// setting off.

const log = createLogger('app');

/** The confirmation shown when quitting with agents running. */
export function quitPrompt(running: RunningAgent[]): MessageBoxOptions {
  const count = running.length === 1 ? '1 agent is' : `${running.length} agents are`;
  return {
    type: 'warning',
    title: `Quit ${APP_NAME}?`,
    message: `${count} still running. Quitting stops ${running.length === 1 ? 'it' : 'them'}.`,
    detail: running
      .map((agent) => `• ${agent.agentName} in ${agent.projectName} (${statusLabel(agent.status)})`)
      .join('\n'),
    buttons: ['Quit and stop agents', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

let confirmed = false;
let asking = false;

/** Windows is shutting down or logging off: no question, and nothing may hold it up. */
export function quitNow(): void {
  confirmed = true;
}

function runningAgents(): RunningAgent[] {
  try {
    return listRunningAgents(getDatabase());
  } catch (err) {
    log.warn({ err }, 'could not list running agents before quitting');
    return [];
  }
}

/**
 * True if quitting may go ahead: no agents are running, or the user agreed to stop them. For
 * quitting that has to know before it starts (installing an update).
 */
export async function confirmQuit(window: BrowserWindow | null): Promise<boolean> {
  if (confirmed) {
    return true;
  }
  const running = runningAgents();
  if (running.length === 0) {
    return true;
  }
  const options = quitPrompt(running);
  const { response } =
    window && window.isVisible()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
  return response === 0;
}

/**
 * For `before-quit`: true if the quit may go ahead now. Otherwise it is held, the user is asked
 * (when agents are running), and `app.quit()` is called again if they agree.
 */
export function allowQuit(window: BrowserWindow | null): boolean {
  if (confirmed) {
    return true;
  }
  if (runningAgents().length === 0) {
    confirmed = true;
    return true;
  }
  if (!asking) {
    asking = true;
    void confirmQuit(window)
      .then((agreed) => {
        if (agreed) {
          confirmed = true;
          app.quit();
        }
      })
      .finally(() => {
        asking = false;
      });
  }
  return false;
}

const HINT_SHOWN = 'trayHintShown';

/**
 * For the window's `close`: hides it instead when the close-to-tray setting is on (and there is
 * a tray to come back from), otherwise starts quitting. The first hide explains where it went.
 */
export function handleWindowClose(
  event: Electron.Event,
  window: BrowserWindow,
  hasTray: boolean,
): void {
  if (confirmed) {
    return;
  }
  event.preventDefault();
  const db = getDatabase();
  if (!hasTray || !getSettings(db).closeToTray) {
    app.quit();
    return;
  }
  window.hide();
  if (!readSetting(db, HINT_SHOWN, z.boolean(), false) && Notification.isSupported()) {
    new Notification({
      title: `${APP_NAME} is still running`,
      body: 'Agents keep working in the background. Open it again from the tray icon.',
    }).show();
    writeSetting(db, HINT_SHOWN, true);
  }
}
