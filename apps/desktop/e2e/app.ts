import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { InvokeChannel } from '@vcode/shared';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';

// Starts the built app (out/) with its own user-data folder, so tests never touch the real
// %APPDATA%\Vcode and the single-instance lock doesn't stop a test's app.

/** Outside Electron, the `electron` package exports the path of its executable. */
// Playwright loads these files as CommonJS, so __filename / __dirname rather than import.meta.
const electronPath = createRequire(__filename)('electron') as string;
const appDir = resolve(__dirname, '..');

/** A new empty folder (real path: macOS's temp folder is behind a symlink). */
export function tempFolder(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), `vcode-e2e-${prefix}-`)));
}

/** The part of the preload bridge the tests use (the page's `window.vcode`). */
interface VcodeBridge {
  invoke: (
    channel: string,
    payload: unknown,
  ) => Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string } }>;
}

export interface RunningApp {
  electron: ElectronApplication;
  page: Page;
  userData: string;
  /** `window.vcode.invoke`, throwing on an error result. */
  call: <T = unknown>(channel: InvokeChannel, payload?: unknown) => Promise<T>;
  /** Console errors from the page so far. */
  errors: string[];
  close: () => Promise<void>;
}

export async function launchApp(userData = tempFolder('data')): Promise<RunningApp> {
  const env = { ...process.env } as Record<string, string>;
  // Set when the tests themselves run under Electron-as-Node (e.g. from VS Code's terminal).
  delete env['ELECTRON_RUN_AS_NODE'];
  const electron = await _electron.launch({
    executablePath: electronPath,
    args: [appDir, `--user-data-dir=${userData}`],
    env,
  });
  const page = await electron.firstWindow();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');

  const call = async <T>(channel: InvokeChannel, payload?: unknown): Promise<T> => {
    const result = await page.evaluate(
      ([c, p]) => (window as unknown as { vcode: VcodeBridge }).vcode.invoke(c, p),
      [channel, payload] as const,
    );
    if (!result.ok) throw new Error(`${channel}: ${result.error.message}`);
    return result.data as T;
  };

  return {
    electron,
    page,
    userData,
    call,
    errors,
    close: async () => {
      // Skips the quit confirmation and tray: the test decides when the app goes. Waits for the
      // process to end, so its files (the database) are let go before the next launch.
      const process = electron.process();
      if (process.exitCode !== null) return;
      const exited = new Promise((done) => process.once('exit', done));
      await electron.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
      await Promise.race([exited, new Promise((done) => setTimeout(done, 10_000))]);
    },
  };
}

/** Deletes a folder made by `tempFolder`; best effort (Windows may hold a file a moment longer). */
export function removeFolder(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (error) {
    console.warn(`Could not delete ${path}:`, error);
  }
}
