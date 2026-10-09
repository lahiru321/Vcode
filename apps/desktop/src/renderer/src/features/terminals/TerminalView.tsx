import {
  MAX_TERMINAL_INPUT,
  TERMINAL_SCROLLBACK,
  type TerminalClientMessage,
  type TerminalHostMessage,
} from '@vcode/shared';
import { openTerminalPort } from '@renderer/lib/terminal-port';
import { cn } from '@renderer/lib/utils';
import { blockClipboardSequences, confirmedLinkHandler } from './safety';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';
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

const FONT_FAMILY =
  "'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace";

interface TerminalViewProps {
  terminalId: string;
  /** Only the active terminal is shown, sized and focused. */
  active: boolean;
  onExit: (exitCode: number) => void;
}

export function TerminalView({ terminalId, active, onExit }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
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
    });
    blockClipboardSequences(terminal);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new SearchAddon());
    terminal.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)));
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

    let port: MessagePort | null = null;
    let disposed = false;
    const send = (message: TerminalClientMessage): void => port?.postMessage(message);

    let lastSize = '';
    const fit = (): void => {
      // A hidden terminal has no size; it is fitted when it becomes active.
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

    const input = terminal.onData((data) => {
      // A very large paste is sent in pieces the PTY host accepts.
      for (let start = 0; start < data.length; start += MAX_TERMINAL_INPUT) {
        send({ type: 'input', data: data.slice(start, start + MAX_TERMINAL_INPUT) });
      }
    });

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
      port?.close();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [terminalId]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        fitRef.current?.();
        terminalRef.current?.focus();
      });
    }
  }, [active]);

  return (
    <div
      className={cn('absolute inset-0 px-2 pt-1.5 pb-0.5', !active && 'hidden')}
      data-terminal-id={terminalId}
    >
      <div ref={containerRef} className="size-full" />
    </div>
  );
}
