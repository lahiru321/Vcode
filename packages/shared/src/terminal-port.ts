// Messages on a terminal's MessagePort, between the renderer and the PTY host (V1 doc §11, §20).
// Terminal data goes straight between them; main only sets the port up (`terminals:attach`).
// No zod here: the PTY host imports this file and doesn't need the IPC contracts.

/** PTY host → renderer. */
export type TerminalHostMessage =
  { type: 'data'; data: string } | { type: 'exit'; exitCode: number; signal: number | null };

/**
 * Renderer → PTY host. `ack` reports how many characters of `data` the terminal has finished
 * drawing; the host pauses a process whose output the renderer can't keep up with.
 */
export type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ack'; chars: number };

/** Largest input accepted in one message (a big paste is split by the renderer). */
export const MAX_TERMINAL_INPUT = 1024 * 1024;

/** Output is sent to the renderer in batches, at most this often (V1 doc §11 "Back-pressure"). */
export const OUTPUT_BATCH_MS = 16;
/** Sent but not yet drawn output above which the process is paused… */
export const FLOW_HIGH_WATERMARK = 100_000;
/** …and below which it is resumed. */
export const FLOW_LOW_WATERMARK = 5_000;
const ACK_CHARS = { min: 1, max: 1_000_000_000 } as const;
export const TERMINAL_COLS = { min: 2, max: 1000 } as const;
export const TERMINAL_ROWS = { min: 1, max: 500 } as const;

function inRange(value: unknown, range: { min: number; max: number }): value is number {
  return (
    Number.isInteger(value) && (value as number) >= range.min && (value as number) <= range.max
  );
}

/**
 * Checks a message from the renderer, which is untrusted: returns it if it is well-formed,
 * otherwise null.
 */
export function parseTerminalClientMessage(value: unknown): TerminalClientMessage | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const message = value as Record<string, unknown>;
  if (
    message['type'] === 'input' &&
    typeof message['data'] === 'string' &&
    message['data'].length <= MAX_TERMINAL_INPUT
  ) {
    return { type: 'input', data: message['data'] };
  }
  if (
    message['type'] === 'resize' &&
    inRange(message['cols'], TERMINAL_COLS) &&
    inRange(message['rows'], TERMINAL_ROWS)
  ) {
    return { type: 'resize', cols: message['cols'], rows: message['rows'] };
  }
  if (message['type'] === 'ack' && inRange(message['chars'], ACK_CHARS)) {
    return { type: 'ack', chars: message['chars'] };
  }
  return null;
}
