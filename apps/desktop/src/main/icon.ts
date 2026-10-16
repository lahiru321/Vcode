import { join, sep } from 'node:path';

/**
 * The app icon (the purple V), copied next to the main bundle by build/copy-resources.ts. In the
 * packaged app it is unpacked from app.asar (electron-builder.yml): Windows notifications read
 * it as a plain file, outside Electron's asar support.
 */
export const APP_ICON_PATH = join(__dirname, 'resources', 'icon.png').replace(
  `${sep}app.asar${sep}`,
  `${sep}app.asar.unpacked${sep}`,
);
