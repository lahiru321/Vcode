// electron-builder `afterPack` hook (electron-builder.yml): flips the Electron fuses in the
// packaged executable before electron-builder signs it. Node strips the types of fuses.ts.
import { join } from 'node:path';
import { applyFuses } from './fuses.ts';

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const name = packager.appInfo.productFilename;
  const executable =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${name}.app`)
      : join(appOutDir, electronPlatformName === 'win32' ? `${name}.exe` : name);
  const changed = await applyFuses(executable, electronPlatformName === 'darwin');
  console.log(`  • fuses applied to ${executable} (${changed} changed)`);
}
