import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the main process and shared code, run in plain Node (not Electron).
// Modules that import `electron` are tested with `vi.mock('electron')`. Renderer tests are
// limited to DOM-free logic (e.g. terminal rules, checked against @xterm/headless).
export default defineConfig({
  resolve: {
    // Never the real package: requiring it can start a binary download (see the stub).
    alias: [
      {
        find: /^electron$/,
        replacement: fileURLToPath(
          new URL('./apps/desktop/src/main/electron-stub.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: [
      'apps/desktop/src/main/**/*.test.ts',
      'apps/desktop/src/pty-host/**/*.test.ts',
      'apps/desktop/src/renderer/**/*.test.ts',
      'apps/desktop/build/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    environment: 'node',
    // Platform tests start real processes (PowerShell, cmd.exe, taskkill).
    testTimeout: 20_000,
    restoreMocks: true,
  },
});
