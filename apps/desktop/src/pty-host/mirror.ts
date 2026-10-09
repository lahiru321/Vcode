import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';
import { TERMINAL_SCROLLBACK } from '@vcode/shared/terminal-port';

// A terminal's screen kept in the PTY host (V1 doc §11): every byte of output goes through a
// headless xterm.js, so a renderer that attaches later (e.g. after a UI reload) gets the
// current screen — colours, cursor, alternate screen, scrollback — instead of raw output.

export class ScreenMirror {
  private readonly terminal: Terminal;
  private readonly serializer = new SerializeAddon();

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback: TERMINAL_SCROLLBACK,
      allowProposedApi: true,
    });
    this.terminal.loadAddon(this.serializer);
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  /** The screen as escape sequences that redraw it, once all output so far is processed. */
  snapshot(): Promise<string> {
    return new Promise((resolve) => {
      this.terminal.write('', () => resolve(this.serialize()));
    });
  }

  /** The screen as processed so far; output still being parsed is not included. */
  serialize(): string {
    return this.serializer.serialize();
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
