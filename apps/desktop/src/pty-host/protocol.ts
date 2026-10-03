import { z } from 'zod';

// Messages between main and the PTY host utility process (V1 doc §5, §11). Main sends requests
// and gets one response per request; the host also sends `ready` once at start-up, `exit` when a
// terminal's process ends, and `log` records for the main log file. Terminal data will not use this channel: each terminal gets its
// own MessagePort straight to the renderer (P2-03).
//
// Both sides are our code, but main validates everything the host sends: the host handles
// untrusted process output, so a bug there shouldn't become a crash or confusion in main.

export interface SpawnParams {
  /** The terminal_sessions row id; names the terminal in every later call. */
  sessionId: string;
  file: string;
  /** A string is a pre-quoted Windows command line (`Command.verbatimArguments`). */
  args: string[] | string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface SessionParams {
  sessionId: string;
}

/** Methods main can call, with their params and results. */
export interface HostMethods {
  ping: { params: undefined; result: { pid: number; uptimeMs: number } };
  /** Starts a process in a new pseudo-terminal. */
  spawn: { params: SpawnParams; result: { pid: number } };
  /** Sends input, as typed (escape sequences included). */
  write: { params: SessionParams & { data: string }; result: null };
  resize: { params: SessionParams & { cols: number; rows: number }; result: null };
  /** Closes the pseudo-terminal, which ends the processes attached to it. */
  kill: { params: SessionParams; result: null };
  /** Connects the MessagePort sent with this request to the terminal (see TerminalManager.attach). */
  attach: { params: SessionParams; result: null };
  /** Recent output (bounded), until the screen mirror replaces it in P2-06. */
  output: { params: SessionParams; result: { data: string } };
  list: { params: undefined; result: { sessions: { sessionId: string; pid: number }[] } };
}
export type HostMethod = keyof HostMethods;
export type HostParams<M extends HostMethod> = HostMethods[M]['params'];
export type HostResult<M extends HostMethod> = HostMethods[M]['result'];

export type MainToHost =
  | { kind: 'request'; id: number; method: HostMethod; params: unknown }
  /** Stop all terminals and exit. */
  | { kind: 'shutdown' };

const LogLevel = z.enum(['debug', 'info', 'warn', 'error']);

// A plain union: zod's discriminatedUnion needs one variant per `kind`, and `response` has two.
export const HostToMain = z.union([
  z.object({ kind: z.literal('ready'), pid: z.number().int().positive() }),
  z.object({
    kind: z.literal('response'),
    id: z.number().int(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    kind: z.literal('response'),
    id: z.number().int(),
    ok: z.literal(false),
    error: z.object({ message: z.string() }),
  }),
  z.object({
    kind: z.literal('exit'),
    sessionId: z.string(),
    exitCode: z.number().int(),
    /** POSIX signal number, if the process was ended by one. */
    signal: z.number().int().nullable(),
  }),
  z.object({
    kind: z.literal('log'),
    level: LogLevel,
    msg: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type HostToMain = z.infer<typeof HostToMain>;
export type HostLogLevel = z.infer<typeof LogLevel>;
