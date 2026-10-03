import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type Level, type Logger } from 'pino';
import { consoleStream } from './console';

// Main-process logging (V1 doc §22: pino, files in the user-data folder). The root logger exists
// from the first import so modules can create their child loggers at load time; until
// initLogging() adds the outputs, records go nowhere. This file doesn't import electron, so
// modules that log can be unit-tested in plain Node.
//
// No pino transports: they run in worker threads, which complicates bundling and packaging.
// The file is written synchronously, so the last lines before a crash aren't lost; volume is low
// (terminal output is never logged).

const LEVELS: readonly Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const FILE_PATTERN = /^main-(\d{4}-\d{2}-\d{2})\.log$/;
const KEEP_DAYS = 14;

/** Keys whose values are replaced wherever they appear (top level or one object down). */
const REDACT_KEYS = ['apiKey', 'api_key', 'token', 'password', 'secret', 'authorization'];

const streams = pino.multistream([]);

const root: Logger = pino(
  {
    base: undefined, // no pid / hostname on every line
    // Children copy the level when created, so the root lets everything through and each
    // output filters by its own level.
    level: 'trace',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_KEYS.flatMap((key) => [key, `*.${key}`]),
      censor: '[redacted]',
    },
  },
  streams,
);

/** A logger whose records are tagged with `module`, e.g. `createLogger('ipc')`. */
export function createLogger(module: string): Logger {
  return root.child({ module });
}

export interface LoggingOptions {
  /** Folder for the log files; created if missing. */
  dir: string;
  /** Minimum level written to the file. */
  level: Level;
  /** Also print readable lines to stdout (development). */
  console: boolean;
}

/** The level from VCODE_LOG_LEVEL, or `fallback` if it's unset or not a level name. */
export function levelFromEnv(fallback: Level): Level {
  const value = process.env['VCODE_LOG_LEVEL']?.toLowerCase();
  return LEVELS.find((level) => level === value) ?? fallback;
}

let logFile: string | undefined;

/** Starts writing to `dir/main-<date>.log` and removes files older than 14 days. Returns the file. */
export function initLogging(options: LoggingOptions): string {
  if (logFile) {
    throw new Error('Logging already initialised');
  }
  mkdirSync(options.dir, { recursive: true });
  logFile = join(options.dir, `main-${localDate(new Date())}.log`);

  streams.add({
    level: options.level,
    stream: pino.destination({ dest: logFile, sync: true, mkdir: true }),
  });
  if (options.console) {
    streams.add({ level: options.level, stream: consoleStream() });
  }

  pruneOldLogs(options.dir);
  return logFile;
}

/** Flushes and closes the outputs. Call when the app quits. */
export function closeLogging(): void {
  streams.flushSync();
  streams.end();
}

function localDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pruneOldLogs(dir: string): void {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(dir)) {
    if (!FILE_PATTERN.test(name)) {
      continue;
    }
    const file = join(dir, name);
    try {
      if (file !== logFile && statSync(file).mtimeMs < cutoff) {
        unlinkSync(file);
      }
    } catch (err) {
      root.warn({ module: 'logging', err, file }, 'could not remove an old log file');
    }
  }
}
