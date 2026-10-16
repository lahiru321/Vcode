import { APP_NAME, APP_REPO_URL } from '@vcode/shared';
import { app } from 'electron';
import { APP_ICON_PATH } from './icon';

// The About window (P8-02): Electron's native panel, opened from the tray and from Settings.

export function configureAbout(): void {
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron} · Node ${process.versions.node}`,
    copyright: `© ${new Date().getFullYear()} Lahiru Samarahewa`,
    website: APP_REPO_URL,
    iconPath: APP_ICON_PATH,
  });
}

export function showAbout(): void {
  app.showAboutPanel();
}
