import { defineConfig } from 'vitest/config';

// Unit tests for the main process and shared code, run in plain Node (not Electron).
// Modules that import `electron` are tested with `vi.mock('electron')`.
export default defineConfig({
  test: {
    include: [
      'apps/desktop/src/main/**/*.test.ts',
      'apps/desktop/src/pty-host/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    environment: 'node',
    // Platform tests start real processes (PowerShell, cmd.exe, taskkill).
    testTimeout: 20_000,
    restoreMocks: true,
  },
});
