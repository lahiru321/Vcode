import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Copies `resources/` (the app icon) next to the main-process bundle, where
 * src/main/icon.ts reads it. Runs for `electron-vite build` and `dev`.
 */
export function copyResources(source = resolve('resources')): Plugin {
  return {
    name: 'vcode:copy-resources',
    writeBundle(options) {
      if (!options.dir) {
        throw new Error('copy-resources: the main build has no output directory');
      }
      if (!existsSync(join(source, 'icon.png'))) {
        throw new Error(`copy-resources: no icon.png in ${source}`);
      }
      const target = join(options.dir, 'resources');
      rmSync(target, { recursive: true, force: true });
      cpSync(source, target, { recursive: true });
    },
  };
}
