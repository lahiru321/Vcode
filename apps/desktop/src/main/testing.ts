import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { SecretBox } from './credentials/service';
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

/**
 * A stand-in for safeStorage: "encrypts" by reversing the base64 of the text, so the stored
 * bytes never contain the secret, and fails to decrypt anything it didn't encrypt.
 */
export function fakeSecretBox(available = true): SecretBox {
  const MARK = 'fake:';
  return {
    isAvailable: () => available,
    encrypt: (secret) =>
      Buffer.from(MARK + [...Buffer.from(secret).toString('base64')].reverse().join('')),
    decrypt: (encrypted) => {
      const text = encrypted.toString();
      if (!text.startsWith(MARK)) {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage');
      }
      return Buffer.from([...text.slice(MARK.length)].reverse().join(''), 'base64').toString();
    },
  };
}

/** A freshly migrated database in a temp folder, closed after the test. */
export function testDatabase(): AppDatabase {
  const db = openDatabase(join(tempDir(), 'test.db'));
  // Registered after tempDir(), so it runs first: close before the folder is deleted.
  cleanups.push(() => db.$client.close());
  return db;
}
