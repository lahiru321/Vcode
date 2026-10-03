import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { openDatabase, type AppDatabase } from './db';

// Helpers for unit tests only; nothing in the app imports this file.

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
});

/** A new empty folder, deleted after the test. Returned as its real path. */
export function tempDir(): string {
  // realpath: on macOS the temp folder is behind a symlink (/var → /private/var).
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'vcode-test-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A freshly migrated database in a temp folder, closed after the test. */
export function testDatabase(): AppDatabase {
  const db = openDatabase(join(tempDir(), 'test.db'));
  // Registered after tempDir(), so it runs first: close before the folder is deleted.
  cleanups.push(() => db.$client.close());
  return db;
}
