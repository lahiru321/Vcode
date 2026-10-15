import { clipboard } from 'electron';
import { handle } from './registry';

// The page has no clipboard permission (security.ts). It may put text on the clipboard, and ask
// for Edit → Paste, which hands the clipboard's text to the focused terminal as a paste event;
// it never reads the clipboard itself.

export function registerClipboardHandlers(): void {
  handle('clipboard:writeText', ({ text }) => {
    clipboard.writeText(text);
    return null;
  });
  handle('clipboard:paste', (_request, { sender }) => {
    sender.paste();
    return null;
  });
}
