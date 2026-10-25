import {
  MAX_TERMINAL_INPUT,
  TERMINAL_SCROLLBACK,
  type TerminalClientMessage,
  type TerminalHostMessage,
} from '@vcode/shared';
import { invoke } from '@renderer/lib/ipc';
import { openTerminalPort } from '@renderer/lib/terminal-port';
import { findMarkdownPaths } from '@renderer/features/markdown/paths';
import { blockClipboardSequences, confirmedLinkHandler } from './safety';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type IDisposable, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';

// One terminal on screen (V1 doc §11): xterm.js connected to the PTY host over the terminal's
// MessagePort. Output goes straight into xterm; keystrokes and size changes go back.

/** Matches the app's dark theme (styles.css). */
const THEME: ITheme = {
  background: '#0a0a0a',
  foreground: '#e5e5e5',
  cursor: '#e5e5e5',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#3a3d41',
  black: '#1e1e1e',
  red: '#f14c4c',
  green: '#23d18b',
  yellow: '#f5f543',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#29b8db',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

/** main asks before opening http(s) links in the browser and refuses anything else (security.ts). */
function openLink(uri: string): void {
  window.open(uri);
}

/** Search matches: all highlighted, the current one stronger (VS Code's find colours). */
const SEARCH_DECORATIONS: ISearchOptions['decorations'] = {
  matchBackground: '#623315',
  matchOverviewRuler: '#d18616',
  activeMatchBackground: '#515c6a',
  activeMatchBorder: '#e5e5e5',
  activeMatchColorOverviewRuler: '#e5e5e5',
};

export interface SearchQuery {
  term: string;
  caseSensitive: boolean;
  /** While typing: keep the current match if it still matches, rather than move on. */
  incremental?: boolean;
}

/** `index` is -1 when there are too many matches to number them. */
export interface SearchResults {
  index: number;
  count: number;
}

/** What the toolbar and menus do to a terminal (P5-04). */
export interface TerminalControls {
  hasSelection: () => boolean;
  /** Puts the selection on the clipboard. */
  copy: () => Promise<void>;
  /** Types the clipboard's text, or a saved copy of its image's path, into the terminal
   * (bracketed paste if the program asks for it); it takes focus first. */
  paste: () => Promise<void>;
  selectAll: () => void;
  /** Clears the screen and scrollback in the view; the program keeps running. */
  clear: () => void;
  focus: () => void;
  /** Selects the next / previous match; returns whether there is one. */
  findNext: (query: SearchQuery) => boolean;
  findPrevious: (query: SearchQuery) => boolean;
  clearSearch: () => void;
  onSearchResults: (listener: (results: SearchResults) => void) => () => void;
}

/**
 * Focuses the terminal and waits until it has focus. Called from a menu, focus only sticks once
 * the menu has closed (its focus trap pulls focus back until then). False if it never does.
 */
async function takeFocus(terminal: Terminal): Promise<boolean> {
  const has = () => document.activeElement === terminal.textarea;
  for (let frame = 0; frame < 30 && !has(); frame++) {
    terminal.focus();
    if (has()) break;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return has();
}

/**
 * Shift+Enter sends ESC CR (what Claude Code's /terminal-setup binds in VS Code), which CLI
 * agents read as "new line" rather than "submit". xterm.js alone sends a plain CR for it.
 */
function shiftEnterNewLine(terminal: Terminal, send: (data: string) => void): void {
  terminal.attachCustomKeyEventHandler((event) => {
    const shiftEnter =
      event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    if (!shiftEnter) return true;
    // xterm.js would act on the keydown and keypress; both are swallowed, the keydown sends.
    if (event.type === 'keydown') send('\x1b\r');
    event.preventDefault();
    return false;
  });
}

/**
 * A paste with no text (an image on the clipboard) is ignored by xterm.js. main saves the image
 * to a file instead and its path is pasted: CLI agents like Claude Code attach it as an image.
 * Returns the cleanup.
 */
function pasteImagesAsPaths(terminal: Terminal, container: HTMLElement): () => void {
  const onPaste = (event: ClipboardEvent): void => {
    if (event.clipboardData?.getData('text/plain')) return;
    event.preventDefault();
    event.stopPropagation();
    invoke('clipboard:saveImage').then(
      ({ path }) => {
        if (path) terminal.paste(/\s/.test(path) ? `"${path}"` : path);
      },
      (error: unknown) => console.warn('Could not paste the image:', error),
    );
  };
  // Capture: it runs before xterm.js's own paste handler on its textarea.
  container.addEventListener('paste', onPaste, true);
  return () => container.removeEventListener('paste', onPaste, true);
}

/**
 * Markdown file paths in the output (`docs/plan.md`, …) become links that open the file in the
 * Markdown viewer. Paths wrapped across lines aren't found. Returns the cleanup.
 */
function markdownLinks(terminal: Terminal, open: (path: string) => void): IDisposable {
  return terminal.registerLinkProvider({
    provideLinks(y, callback) {
      const line = terminal.buffer.active.getLine(y - 1)?.translateToString(true) ?? '';
      const links = findMarkdownPaths(line).map(({ start, text }) => ({
        range: { start: { x: start + 1, y }, end: { x: start + text.length, y } },
        text,
        decorations: { pointerCursor: true, underline: true },
        activate: () => open(text),
      }));
      callback(links.length > 0 ? links : undefined);
    },
  });
}

const FONT_FAMILY =
  "'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace";

interface TerminalViewProps {
  terminalId: string;
  /** Shown in its panel group: it is sized when this turns on. */
  visible: boolean;
  /** The active panel: it takes keyboard focus when this turns on. */
  focused: boolean;
  onExit: (exitCode: number) => void;
  /** Called with the terminal's controls once it is created, and with null when it goes. */
  onControls?: (controls: TerminalControls | null) => void;
  /** Opens a Markdown file path clicked in the output. */
  onOpenMarkdown?: (path: string) => void;
}

export function TerminalView({
  terminalId,
  visible,
  focused,
  onExit,
  onControls,
  onOpenMarkdown,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onExitRef = useRef(onExit);
  const onControlsRef = useRef(onControls);
  const onOpenMarkdownRef = useRef(onOpenMarkdown);
  useEffect(() => {
    onExitRef.current = onExit;
    onControlsRef.current = onControls;
    onOpenMarkdownRef.current = onOpenMarkdown;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: TERMINAL_SCROLLBACK,
      theme: THEME,
      linkHandler: confirmedLinkHandler(openLink),
      allowProposedApi: true, // search match decorations
    });
    blockClipboardSequences(terminal);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const search = new SearchAddon();
    terminal.loadAddon(search);
    terminal.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)));
    const fileLinks = markdownLinks(terminal, (path) => onOpenMarkdownRef.current?.(path));
    terminal.open(container);
    try {
      const webgl = new WebglAddon();
      // Falls back to the DOM renderer if the GPU context is lost.
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      // No WebGL: the DOM renderer is used.
    }
    terminalRef.current = terminal;

    const searchOptions = (query: SearchQuery): ISearchOptions => ({
      caseSensitive: query.caseSensitive,
      incremental: query.incremental,
      decorations: SEARCH_DECORATIONS,
    });
    onControlsRef.current?.({
      hasSelection: () => terminal.hasSelection(),
      copy: async () => {
        if (terminal.hasSelection()) {
          await invoke('clipboard:writeText', { text: terminal.getSelection() });
        }
      },
      // Main runs Edit → Paste on this window, which goes to whatever has focus.
      paste: async () => {
        if (await takeFocus(terminal)) await invoke('clipboard:paste');
      },
      selectAll: () => terminal.selectAll(),
      clear: () => terminal.clear(),
      focus: () => terminal.focus(),
      findNext: (query) => search.findNext(query.term, searchOptions(query)),
      findPrevious: (query) => search.findPrevious(query.term, searchOptions(query)),
      clearSearch: () => search.clearDecorations(),
      onSearchResults: (listener) => {
        const subscription = search.onDidChangeResults((event) =>
          listener({ index: event.resultIndex, count: event.resultCount }),
        );
        return () => subscription.dispose();
      },
    });

    let port: MessagePort | null = null;
    let disposed = false;
    const send = (message: TerminalClientMessage): void => port?.postMessage(message);

    let lastSize = '';
    const fit = (): void => {
      // A hidden terminal has no size; it is fitted when it becomes visible.
      if (disposed || container.clientWidth === 0 || container.clientHeight === 0) {
        return;
      }
      fitAddon.fit();
      const size = `${terminal.cols}x${terminal.rows}`;
      if (size !== lastSize) {
        lastSize = size;
        send({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
      }
    };
    fitRef.current = fit;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(container);

    const sendInput = (data: string): void => {
      // A very large paste is sent in pieces the PTY host accepts.
      for (let start = 0; start < data.length; start += MAX_TERMINAL_INPUT) {
        send({ type: 'input', data: data.slice(start, start + MAX_TERMINAL_INPUT) });
      }
    };
    const input = terminal.onData(sendInput);
    shiftEnterNewLine(terminal, sendInput);
    const stopImagePaste = pasteImagesAsPaths(terminal, container);

    openTerminalPort(terminalId).then(
      (opened) => {
        if (disposed) {
          opened.close();
          return;
        }
        port = opened;
        port.onmessage = (event: MessageEvent<TerminalHostMessage>) => {
          const message = event.data;
          if (message.type === 'data') {
            // Acknowledged once drawn: the PTY host pauses the process while we are behind.
            const chars = message.data.length;
            terminal.write(message.data, () => send({ type: 'ack', chars }));
          } else {
            // Dimmed note, then hide the cursor: the terminal takes no more input.
            terminal.write(
              `\r\n\x1b[2m[Process exited with code ${message.exitCode}]\x1b[0m\r\n\x1b[?25l`,
            );
            onExitRef.current(message.exitCode);
          }
        };
        lastSize = '';
        fit(); // tell the PTY the real size
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        terminal.write(`\x1b[31mCould not connect to the terminal: ${reason}\x1b[0m\r\n`);
      },
    );

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      input.dispose();
      stopImagePaste();
      fileLinks.dispose();
      port?.close();
      onControlsRef.current?.(null);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [terminalId]);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => fitRef.current?.());
    }
  }, [visible]);

  useEffect(() => {
    if (focused) {
      requestAnimationFrame(() => terminalRef.current?.focus());
    }
  }, [focused]);

  return (
    <div className="size-full bg-[#0a0a0a] px-2 pt-1.5 pb-0.5" data-terminal-id={terminalId}>
      <div ref={containerRef} className="size-full" />
    </div>
  );
}
