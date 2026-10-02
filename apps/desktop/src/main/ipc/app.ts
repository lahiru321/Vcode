import { APP_NAME } from '@vcode/shared';
import { app } from 'electron';
import { handle } from './registry';

export function registerAppHandlers(): void {
  handle('app:getInfo', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));
}
