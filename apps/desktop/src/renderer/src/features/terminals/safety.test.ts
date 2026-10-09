import { Terminal } from '@xterm/headless';
import { describe, expect, it, vi } from 'vitest';
import { blockClipboardSequences, confirmedLinkHandler } from './safety';

// Checked against @xterm/headless, which shares xterm.js's parser.

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

describe('blockClipboardSequences', () => {
  it('swallows OSC 52 before any other handler sees it', async () => {
    const terminal = new Terminal({ allowProposedApi: true });
    const clipboard = vi.fn(() => false); // stands in for a clipboard add-on
    terminal.parser.registerOscHandler(52, clipboard);
    blockClipboardSequences(terminal);

    await write(terminal, '\x1b]52;c;cm0gLXJmIH4=\x07'); // "rm -rf ~"
    await write(terminal, '\x1b]52;c;?\x1b\\'); // a read request, ST-terminated
    expect(clipboard).not.toHaveBeenCalled();
    terminal.dispose();
  });

  it('leaves other sequences alone', async () => {
    const terminal = new Terminal({ allowProposedApi: true });
    blockClipboardSequences(terminal);
    const titles: string[] = [];
    terminal.onTitleChange((title) => titles.push(title));
    await write(terminal, '\x1b]0;my title\x07after');
    expect(titles).toEqual(['my title']);
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('after');
    terminal.dispose();
  });
});

describe('confirmedLinkHandler', () => {
  it('hands the real target to `open` and allows only http(s)', () => {
    const open = vi.fn();
    const handler = confirmedLinkHandler(open);
    handler.activate({} as MouseEvent, 'https://example.com/x', {
      start: { x: 1, y: 1 },
      end: { x: 5, y: 1 },
    });
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/x');
    expect(handler.allowNonHttpProtocols).toBe(false);
  });
});
