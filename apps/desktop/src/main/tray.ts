import { APP_NAME, type AgentSessionStatus } from '@vcode/shared';
import {
  Menu,
  nativeImage,
  Tray,
  type BrowserWindow,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron';
import { agentSessionEvents, listRunningAgents, type RunningAgent } from './agents/sessions';
import { getDatabase } from './db';
import { APP_ICON_PATH } from './icon';
import { broadcastEvent } from './ipc';
import { createLogger } from './logging';

// System tray (P7-01, V1 doc §5): the running-agent count, and Show / Hide, New Terminal, Quit.

const log = createLogger('tray');

// ── Icon ─────────────────────────────────────────────────────────────────────────────────
// The app icon at 16 px (plus a 2× copy), with a green dot in the corner while agents run.

/**
 * Where the running dot goes on a `size` × `size` icon: `dot` (green), `ring` (cleared, to set
 * it apart from the icon), or null (the icon shows).
 */
export function dotPixel(x: number, y: number, size: number): 'dot' | 'ring' | null {
  const centre = size * 0.78;
  const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
  if (distance <= size * 0.19) return 'dot';
  if (distance <= size * 0.27) return 'ring';
  return null;
}

/** Green, as a raw bitmap's BGRA bytes. */
const GREEN_BGRA = [94, 197, 34, 255];

function trayIcon(source: NativeImage, running: boolean): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = 16 * scale;
    const buffer = source.resize({ width: size, height: size, quality: 'best' }).toBitmap();
    if (running) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const spot = dotPixel(x, y, size);
          if (spot) buffer.set(spot === 'dot' ? GREEN_BGRA : [0, 0, 0, 0], (y * size + x) * 4);
        }
      }
    }
    image.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer });
  }
  return image;
}

// ── Menu ─────────────────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Partial<Record<AgentSessionStatus, string>> = {
  created: 'starting',
  starting: 'starting',
  ready: 'ready',
  working: 'working',
  waiting: 'waiting for input',
};

/** How a running agent's status reads in menus and dialogs. */
export function statusLabel(status: AgentSessionStatus): string {
  return STATUS_LABEL[status] ?? status;
}

export function runningSummary(count: number): string {
  if (count === 0) return 'No agents running';
  return count === 1 ? '1 agent running' : `${count} agents running`;
}

export interface TrayActions {
  toggleWindow: () => void;
  newTerminal: () => void;
  quit: () => void;
}

/** The tray menu: running agents (not clickable), then the actions. */
export function trayMenuTemplate(
  running: RunningAgent[],
  windowVisible: boolean,
  actions: TrayActions,
): MenuItemConstructorOptions[] {
  return [
    { label: runningSummary(running.length), enabled: false },
    ...running.map((agent): MenuItemConstructorOptions => ({
      label: `    ${agent.agentName} · ${agent.projectName} (${statusLabel(agent.status)})`,
      enabled: false,
    })),
    { type: 'separator' },
    { label: windowVisible ? `Hide ${APP_NAME}` : `Show ${APP_NAME}`, click: actions.toggleWindow },
    { label: 'New Terminal…', click: actions.newTerminal },
    { type: 'separator' },
    { label: `Quit ${APP_NAME}`, click: actions.quit },
  ];
}

// ── Tray ─────────────────────────────────────────────────────────────────────────────────

/** Shows, restores and focuses the window. */
export function showWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export interface AppTray {
  /** Re-reads running agents and the window state into the icon, tooltip and menu. */
  refresh: () => void;
  /** Starts following `window`'s show / hide / minimize / restore. */
  watchWindow: (window: BrowserWindow) => void;
  destroy: () => void;
}

/**
 * Creates the tray icon for `getWindow()`'s window. It updates itself when agents start, change
 * status or end, and when a watched window is shown or hidden.
 */
export function createTray(getWindow: () => BrowserWindow | null, quit: () => void): AppTray {
  const source = nativeImage.createFromPath(APP_ICON_PATH);
  if (source.isEmpty()) {
    log.warn({ path: APP_ICON_PATH }, 'app icon missing; the tray icon will be blank');
  }
  const icons = { idle: trayIcon(source, false), running: trayIcon(source, true) };
  const tray = new Tray(icons.idle);

  const toggleWindow = () => {
    const window = getWindow();
    if (!window) return;
    if (window.isVisible() && !window.isMinimized()) window.hide();
    else showWindow(window);
  };
  const actions: TrayActions = {
    toggleWindow,
    newTerminal: () => {
      const window = getWindow();
      if (!window) return;
      showWindow(window);
      broadcastEvent('app:command', { command: 'newTerminal' });
    },
    quit,
  };

  const refresh = () => {
    if (tray.isDestroyed()) return;
    let running: RunningAgent[] = [];
    try {
      running = listRunningAgents(getDatabase());
    } catch (err) {
      log.warn({ err }, 'could not list running agents');
    }
    const window = getWindow();
    const visible = window !== null && window.isVisible() && !window.isMinimized();
    tray.setImage(running.length > 0 ? icons.running : icons.idle);
    tray.setToolTip(`${APP_NAME} — ${runningSummary(running.length)}`);
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(running, visible, actions)));
  };

  tray.on('click', toggleWindow);
  agentSessionEvents.on('status', refresh);
  refresh();

  return {
    refresh,
    watchWindow: (window) => {
      window.on('show', refresh);
      window.on('hide', refresh);
      window.on('minimize', refresh);
      window.on('restore', refresh);
    },
    destroy: () => {
      agentSessionEvents.off('status', refresh);
      tray.destroy();
    },
  };
}
