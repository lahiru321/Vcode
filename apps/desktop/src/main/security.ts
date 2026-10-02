import { app, BrowserWindow, dialog, session, shell, type WebContents } from 'electron';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/** Only plain web links may leave the app; file:, javascript:, custom schemes etc. are refused. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Process-wide security settings. Must be called before `app.whenReady()`.
 * Spec: V1 doc §21 (Electron hardening).
 */
export function applySecurityBaseline(): void {
  // Every renderer runs sandboxed, even if a window forgets to ask for it.
  app.enableSandbox();

  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents);
  });

  void app.whenReady().then(() => {
    // The UI needs no browser permissions (camera, geolocation, notifications, …).
    // Clipboard access for terminals is granted explicitly in P5-04.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler(() => false);
  });
}

function hardenWebContents(contents: WebContents): void {
  // The app is a single page: block every navigation. Web links open in the system browser.
  contents.on('will-navigate', (event) => {
    event.preventDefault();
    void openExternalWithConfirmation(contents, event.url);
  });
  contents.on('will-redirect', (event) => {
    event.preventDefault();
  });

  // No new Electron windows from the renderer (window.open, target="_blank").
  contents.setWindowOpenHandler(({ url }) => {
    void openExternalWithConfirmation(contents, url);
    return { action: 'deny' };
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

async function openExternalWithConfirmation(contents: WebContents, url: string): Promise<void> {
  if (!isSafeExternalUrl(url)) {
    return;
  }

  const window = BrowserWindow.fromWebContents(contents);
  const options = {
    type: 'question' as const,
    buttons: ['Open in browser', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Open this link in your browser?',
    detail: url,
  };
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);

  if (response === 0) {
    await shell.openExternal(url);
  }
}
