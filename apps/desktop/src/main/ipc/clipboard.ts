import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, clipboard } from 'electron';
import { handle } from './registry';

// The page has no clipboard permission (security.ts). It may put text on the clipboard, and ask
// for Edit → Paste, which hands the clipboard's text to the focused terminal as a paste event;
// it never reads the clipboard itself. A pasted image is saved here and only its path goes back.

/** Pasted images are kept this long: long enough for an agent to read one after it's sent. */
const PASTED_IMAGE_LIFETIME_MS = 24 * 60 * 60 * 1000;

function pastedImagesFolder(): string {
  return join(app.getPath('temp'), 'Vcode', 'pasted-images');
}

/** Deletes images pasted more than a day ago; best effort. */
async function pruneOldImages(folder: string): Promise<void> {
  const cutoff = Date.now() - PASTED_IMAGE_LIFETIME_MS;
  for (const name of await readdir(folder).catch(() => [])) {
    const path = join(folder, name);
    try {
      if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
    } catch {
      // Gone already, or in use: the next paste tries again.
    }
  }
}

async function saveClipboardImage(): Promise<string | null> {
  const item = (await clipboard.read()).find((entry) => entry.types.includes('image/png'));
  if (!item) {
    return null;
  }
  const png = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
  const folder = pastedImagesFolder();
  await mkdir(folder, { recursive: true });
  await pruneOldImages(folder);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(folder, `image-${stamp}.png`);
  await writeFile(path, png);
  return path;
}

export function registerClipboardHandlers(): void {
  handle('clipboard:writeText', ({ text }) => {
    clipboard.writeText(text);
    return null;
  });
  handle('clipboard:paste', (_request, { sender }) => {
    sender.paste();
    return null;
  });
  handle('clipboard:saveImage', async () => ({ path: await saveClipboardImage() }));
}
