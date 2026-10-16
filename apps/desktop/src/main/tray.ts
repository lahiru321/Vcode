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
import { broadcastEvent } from './ipc';
import { createLogger } from './logging';

// System tray (P7-01, V1 doc §5): the running-agent count, and Show / Hide, New Terminal, Quit.

const log = createLogger('tray');

// ── Icon ─────────────────────────────────────────────────────────────────────────────────
// Drawn in code until the app has an icon (P8-02): a blue rounded square with a white ">_"
// prompt, and a green dot in the corner while agents are running. 16 px, plus a 2× copy.

type Rgba = readonly [number, number, number, number];
const BLUE: Rgba = [37, 99, 235, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const GREEN: Rgba = [34, 197, 94, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

const GRID = 16;
/** Columns of the prompt's white cells per row (">" then "_"). */
const PROMPT: Record<number, number[]> = {
  4: [3, 4],
  5: [4, 5],
  6: [5, 6],
  7: [6, 7],
  8: [5, 6],
  9: [4, 5],
  10: [3, 4, 9, 10, 11, 12],
  11: [9, 10, 11, 12],
};

/** The colour of cell (x, y) on the 16 × 16 grid. */
export function iconPixel(x: number, y: number, running: boolean): Rgba {
  if (running) {
    const distance = (x - 12.5) ** 2 + (y - 12.5) ** 2;
    if (distance <= 9) return GREEN;
    // A transparent ring keeps the dot apart from the square.
    if (distance <= 16) return CLEAR;
  }
  const inset = y === 0 || y === GRID - 1 ? 2 : y === 1 || y === GRID - 2 ? 1 : 0;
  if (x < inset || x >= GRID - inset) return CLEAR;
  return PROMPT[y]?.includes(x) ? WHITE : BLUE;
}

function drawIcon(running: boolean): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = GRID * scale;
    const buffer = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b, a] = iconPixel(Math.floor(x / scale), Math.floor(y / scale), running);
        // Raw bitmaps are BGRA.
        buffer.set([b, g, r, a], (y * size + x) * 4);
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
  const icons = { idle: drawIcon(false), running: drawIcon(true) };
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
