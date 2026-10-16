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

/**
 * For `before-quit`: true if the quit may go ahead now. Otherwise it is held, the user is asked
 * (when agents are running), and `app.quit()` is called again if they agree.
 */
export function allowQuit(window: BrowserWindow | null): boolean {
  if (confirmed) {
    return true;
  }
  let running: RunningAgent[] = [];
  try {
    running = listRunningAgents(getDatabase());
  } catch (err) {
    log.warn({ err }, 'could not list running agents before quitting');
  }
  if (running.length === 0) {
    confirmed = true;
    return true;
  }
  if (!asking) {
    asking = true;
    const options = quitPrompt(running);
    const answer =
      window && window.isVisible()
        ? dialog.showMessageBox(window, options)
        : dialog.showMessageBox(options);
    void answer
      .then(({ response }) => {
        if (response === 0) {
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
