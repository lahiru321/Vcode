import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { z } from 'zod';
import { getDatabase } from './db';
import { readSetting, writeSetting } from './settings/store';

// Remembers the main window's size, position and maximized state (V1 doc §10 "Window state").
// Main-only: stored in `app_settings` but not part of the renderer's settings.

const SETTING_KEY = 'window.main';
const SAVE_DELAY_MS = 500;
/** How much of the title bar must be on a screen for the saved position to be reused. */
const MIN_VISIBLE = { width: 120, height: 40 };

const WindowState = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maximized: z.boolean(),
});
type WindowState = z.infer<typeof WindowState>;

export interface WindowSizeLimits {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/** Bounds for the new window: `x`/`y` are left out (centred) when there's nothing to restore. */
export interface InitialWindowState {
  bounds: Partial<Rectangle> & { width: number; height: number };
  maximized: boolean;
}

function overlap(a: Rectangle, b: Rectangle): Rectangle {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

/** True if enough of the window's top edge is on some display to grab and move it. */
function isReachable(bounds: Rectangle): boolean {
  const titleBar = { ...bounds, height: MIN_VISIBLE.height };
  return screen.getAllDisplays().some((display) => {
    const visible = overlap(titleBar, display.workArea);
    return visible.width >= MIN_VISIBLE.width && visible.height >= MIN_VISIBLE.height;
  });
}

/**
 * The saved state, adjusted to the current displays: a window that would open off-screen
 * (e.g. its monitor was unplugged) is centred instead, and its size is capped to the work area.
 */
export function loadWindowState(limits: WindowSizeLimits): InitialWindowState {
  const saved = readSetting(getDatabase(), SETTING_KEY, WindowState.nullable(), null);
  if (!saved) {
    return { bounds: { width: limits.width, height: limits.height }, maximized: false };
  }

  const width = Math.max(saved.width, limits.minWidth);
  const height = Math.max(saved.height, limits.minHeight);
  const bounds = { x: saved.x, y: saved.y, width, height };
  if (isReachable(bounds)) {
    return { bounds, maximized: saved.maximized };
  }

  const { workArea } = screen.getPrimaryDisplay();
  return {
    bounds: {
      width: Math.max(Math.min(width, workArea.width), limits.minWidth),
      height: Math.max(Math.min(height, workArea.height), limits.minHeight),
    },
    maximized: saved.maximized,
  };
}

/** Saves the window's state shortly after it moves or resizes, and when it closes. */
export function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;

  const save = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) {
      return;
    }
    // Normal bounds = the size to restore to, even while maximized.
    const state: WindowState = { ...window.getNormalBounds(), maximized: window.isMaximized() };
    try {
      writeSetting(getDatabase(), SETTING_KEY, state);
    } catch (error) {
      console.error('[window-state] could not save:', error);
    }
  };

  const scheduleSave = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };

  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', save);
}
