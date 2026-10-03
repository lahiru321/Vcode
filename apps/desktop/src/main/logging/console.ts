import { Writable } from 'node:stream';

// Readable one-line output for the dev terminal, e.g.
// `14:02:11.481 WARN  [ipc] rejected projects:list {"url":"…"}`. The log file keeps the JSON.

const LEVEL_NAMES: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO ',
  40: 'WARN ',
  50: 'ERROR',
  60: 'FATAL',
};

interface ErrorRecord {
  message?: string;
  stack?: string;
}

/** `14:02:11.481` in local time; the file keeps UTC ISO timestamps. */
function localClock(date: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function format(line: string): string {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line;
  }
  const { level, time, module, msg, err, ...extra } = record;
  const clock = typeof time === 'string' ? localClock(new Date(time)) : '';
  const name = LEVEL_NAMES[level as number] ?? String(level);
  const tag = typeof module === 'string' ? ` [${module}]` : '';
  const fields = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  const error = err ? `\n${(err as ErrorRecord).stack ?? (err as ErrorRecord).message}` : '';
  return `${clock} ${name}${tag} ${String(msg ?? '')}${fields}${error}\n`;
}

export function consoleStream(): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      process.stdout.write(format(chunk.toString()));
      callback();
    },
  });
}
