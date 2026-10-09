import type { IDisposable, ILinkHandler, IParser } from '@xterm/xterm';

// Terminal output is untrusted (V1 doc §21): a program — or a file it prints — must not be able
// to act for the user. Links open only after the user confirms, and programs can't write to the
// clipboard.

/** OSC 52: "set clipboard contents". */
const OSC_CLIPBOARD = 52;

/**
 * Swallows OSC 52 clipboard writes (and reads). xterm.js ignores them unless the clipboard
 * add-on is loaded; this keeps them blocked even if it ever is.
 */
export function blockClipboardSequences(terminal: { parser: IParser }): IDisposable {
  return terminal.parser.registerOscHandler(OSC_CLIPBOARD, () => true);
}

/**
 * OSC 8 hyperlinks (links a program embeds in its output, not just URLs in the text) go the
 * same way as detected URLs: `window.open`, which main turns into "Open this link in your
 * browser?" for http(s) and refuses otherwise (security.ts). The link text can differ from its
 * target, so the dialog shows the real URL.
 */
export function confirmedLinkHandler(open: (uri: string) => void): ILinkHandler {
  return {
    activate: (_event, uri) => open(uri),
    allowNonHttpProtocols: false,
  };
}
