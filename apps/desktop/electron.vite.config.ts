import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { copyMigrations } from './build/copy-migrations';
import { contentSecurityPolicy } from './build/csp';

// Workspace packages ship TypeScript source, so main must bundle them instead of
// leaving them as runtime require() calls.
const workspacePackages = ['@agent-hub/shared', '@agent-hub/adapters'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
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
