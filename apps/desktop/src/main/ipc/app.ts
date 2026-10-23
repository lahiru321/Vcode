import { APP_NAME } from '@vcode/shared';
import { app } from 'electron';
import { showAbout } from '../about';
import { platform } from '../platform';
import { activeUpdater } from '../updater';
import { handle } from './registry';

export function registerAppHandlers(): void {
  handle('app:getInfo', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: platform.name,
    fileManagerName: platform.fileManagerName,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));
  handle('app:showAbout', () => {
    showAbout();
    return null;
  });
  handle('app:getUpdate', () => activeUpdater()?.state() ?? { ready: null });
  handle('app:restartToUpdate', async () => {
    await activeUpdater()?.restartToUpdate();
    return null;
  });
}
