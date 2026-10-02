import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Copies the Drizzle migrations (SQL + journal) next to the main-process bundle, where
 * src/main/db/index.ts reads them at startup. Runs for `electron-vite build` and `dev`.
 */
export function copyMigrations(source = resolve('src/main/db/migrations')): Plugin {
  return {
    name: 'agent-hub:copy-migrations',
    writeBundle(options) {
      if (!options.dir) {
        throw new Error('copy-migrations: the main build has no output directory');
      }
      if (!existsSync(join(source, 'meta', '_journal.json'))) {
        throw new Error(`copy-migrations: no Drizzle migrations in ${source}`);
      }
      const target = join(options.dir, 'migrations');
      rmSync(target, { recursive: true, force: true });
      cpSync(source, target, { recursive: true });
    },
  };
}
