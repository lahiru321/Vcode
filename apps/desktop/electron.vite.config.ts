import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { copyMigrations } from './build/copy-migrations';
import { contentSecurityPolicy } from './build/csp';

// Workspace packages ship TypeScript source, so main must bundle them instead of
// leaving them as runtime require() calls.
const workspacePackages = ['@vcode/shared', '@vcode/adapters'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // The PTY host utility process (src/main/pty-host forks out/main/pty-host.js).
          'pty-host': resolve('src/pty-host/index.ts'),
        },
      },
    },
    plugins: [copyMigrations()],
  },
  preload: {
    build: {
      // Sandboxed preloads cannot require node_modules, so bundle everything.
      externalizeDeps: false,
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  },
});
