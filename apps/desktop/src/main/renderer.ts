import { join, relative, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, net, protocol, type BrowserWindow } from 'electron';

// Where the UI comes from. Development: the Vite dev server (electron-vite sets
// ELECTRON_RENDERER_URL). Built: app://vcode/, a custom scheme serving only out/renderer, rather
// than file://. The GrantFileProtocolExtraPrivileges fuse (build/fuses.ts) takes file:// pages'
// extra rights away, and Electron recommends a custom protocol in its place; it also keeps the
// page from reading any other file on disk.

const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const rendererRoot = join(__dirname, '../renderer');

export const APP_SCHEME = 'app';
const APP_HOST = 'vcode';
export const RENDERER_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/**
 * The file under `root` that an app:// URL names, or null for anything else (another host, a
 * path that climbs out of `root`). Exported for tests.
 */
export function rendererFile(root: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) {
    return null;
  }
  const file = resolve(root, `.${decodeURIComponent(parsed.pathname)}`);
  const inside = relative(root, file);
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? file : null;
}

/** Call before `app.whenReady()`: the scheme must be known to Chromium from the start. */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    // `standard` + `secure`: relative URLs, ES modules and a real origin, like https.
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Call once the app is ready: serves out/renderer on app://vcode/. */
export function serveRenderer(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const file = rendererFile(rendererRoot, request.url);
    if (!file) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

export function loadRenderer(window: BrowserWindow): Promise<void> {
  return window.loadURL(devServerUrl ?? RENDERER_URL);
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
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}` === RENDERER_URL;
}
