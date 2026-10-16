import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, removeFolder, tempFolder, type RunningApp } from './app';

// Smoke tests (P7-08): the main paths through the real, built app.

interface Project {
  id: string;
  name: string;
}

let app: RunningApp | undefined;
const folders: string[] = [];

function folder(prefix: string): string {
  const path = tempFolder(prefix);
  folders.push(path);
  return path;
}

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const path of folders.splice(0)) removeFolder(path);
});

/** A project for `root`, created through IPC (the native folder picker can't be driven). */
async function addProject(running: RunningApp, root: string): Promise<Project> {
  const project = await running.call<Project>('projects:create', { rootPath: root });
  await running.page.reload();
  await running.page.getByText(project.name, { exact: true }).first().click();
  return project;
}

test('starts with the main window and no errors', async () => {
  app = await launchApp(folder('data'));
  await expect(app.page).toHaveTitle('Vcode');
  await expect(app.page.getByText('Projects', { exact: true })).toBeVisible();
  await expect(app.page.getByText('No projects yet')).toBeVisible();
  await expect(app.page.getByText(/Ready/)).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('runs a command in a real shell, and brings the layout back after a restart', async () => {
  const userData = folder('data');
  const root = join(folder('project'), 'shop');
  mkdirSync(root);
  app = await launchApp(userData);
  const project = await addProject(app, root);
  await expect(app.page.getByText(root)).toBeVisible();

  // A new shell (Ctrl+Shift+T; Cmd on macOS), then a command typed into it.
  await app.page.keyboard.press('ControlOrMeta+Shift+T');
  await expect
    .poll(async () =>
      (await app!.call<{ status: string }[]>('terminals:list', { projectId: project.id })).map(
        (t) => t.status,
      ),
    )
    .toEqual(['running']);
  await app.page.locator('.xterm').first().click();
  // Same command in PowerShell, cmd, zsh and bash; the terminal draws to a canvas, so the file
  // it writes is the proof.
  await app.page.keyboard.type('echo vcode-e2e > e2e-proof.txt');
  await app.page.keyboard.press('Enter');
  await expect.poll(() => existsSync(join(root, 'e2e-proof.txt'))).toBe(true);

  // Restart the app: the project is selected again and its panel comes back, ended.
  await expect
    .poll(
      async () =>
        (await app!.call<{ layout: unknown }>('projects:getLayout', { id: project.id })).layout,
    )
    .not.toBeNull();
  await app.close();
  app = await launchApp(userData);
  await expect(app.page.getByText(root)).toBeVisible();
  // The ended panel: the terminal's screen is gone, so it offers a restart.
  const ended = app.page.getByText(/Restart it to run/);
  await expect(ended).toBeVisible();
  await expect(
    app.page.locator('div', { has: ended }).getByRole('button', { name: 'Restart' }).last(),
  ).toBeVisible();
});

test('keeps settings and records actions in the audit log', async () => {
  const userData = folder('data');
  const root = join(folder('project'), 'blog');
  mkdirSync(root);
  app = await launchApp(userData);
  await addProject(app, root);
  await app.call('workspaces:create', {
    projectId: (await app.call<Project[]>('projects:list'))[0]!.id,
    name: 'Docs',
    kind: 'folder',
  });

  // Settings: turn notifications off; still off after a restart.
  await app.page.getByRole('button', { name: 'Settings' }).click();
  const notify = app.page.getByLabel('Notify me about agents');
  await expect(notify).toBeChecked();
  await notify.uncheck();
  await expect
    .poll(async () => (await app!.call<{ notifications: boolean }>('settings:get')).notifications)
    .toBe(false);
  await app.close();
  app = await launchApp(userData);
  await app.page.getByRole('button', { name: 'Settings' }).click();
  await expect(app.page.getByLabel('Notify me about agents')).not.toBeChecked();
  await app.page.keyboard.press('Escape');

  // Audit log: newest first.
  await app.page.getByRole('button', { name: 'Audit log' }).click();
  const rows = app.page.getByRole('dialog').getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Added folder workspace “Docs”');
  await expect(rows.nth(1)).toContainText('Added project “blog”');
});
