import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, type BrowserWindow } from 'electron';

// electron-vite sets ELECTRON_RENDERER_URL to the Vite dev server in development.
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const rendererIndexPath = join(__dirname, '../renderer/index.html');

export function loadRenderer(window: BrowserWindow): Promise<void> {
  return devServerUrl ? window.loadURL(devServerUrl) : window.loadFile(rendererIndexPath);
}

/** True if `url` is the app's own UI: the Vite dev server in development, index.html when built. */
export function isRendererUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (devServerUrl) {
    return parsed.origin === new URL(devServerUrl).origin;
  }
  return (
    parsed.protocol === 'file:' && parsed.pathname === pathToFileURL(rendererIndexPath).pathname
  );
}
