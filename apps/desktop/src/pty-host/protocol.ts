import { z } from 'zod';

// Messages between main and the PTY host utility process (V1 doc §5, §11). Main sends requests
// and gets one response per request; the host also sends `ready` once at start-up and `log`
// records for the main log file. Terminal data will not use this channel: each terminal gets its
// own MessagePort straight to the renderer (P2-03).
//
// Both sides are our code, but main validates everything the host sends: the host handles
// untrusted process output, so a bug there shouldn't become a crash or confusion in main.

/** Methods main can call, with their params and results. P2-02 adds spawn / write / resize / kill. */
export interface HostMethods {
  ping: { params: undefined; result: { pid: number; uptimeMs: number } };
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
    kind: z.literal('log'),
    level: LogLevel,
    msg: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type HostToMain = z.infer<typeof HostToMain>;
export type HostLogLevel = z.infer<typeof LogLevel>;
