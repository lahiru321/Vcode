import { defineConfig } from '@playwright/test';

// End-to-end smoke tests (P7-08): the built app (`pnpm build` first) driven through Playwright's
// Electron support. One app at a time: each test gets its own user-data folder.
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
    : 'list',
  outputDir: '../test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
