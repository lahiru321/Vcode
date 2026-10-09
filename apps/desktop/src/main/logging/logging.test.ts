import { readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../testing';
import type * as LoggingModule from '.';

// The logger keeps module state (one init per process), so every test loads a fresh copy.
let logging: typeof LoggingModule;

beforeEach(async () => {
  vi.resetModules();
  logging = await import('.');
});

afterEach(() => {
  try {
    logging.closeLogging();
  } catch {
    // Not initialised in this test.
  }
  vi.unstubAllEnvs();
});

function readLines(file: string): Record<string, unknown>[] {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('logging', () => {
  it('writes JSON lines with the module name to a dated file', () => {
    const dir = tempDir();
    const file = logging.initLogging({ dir, level: 'info', console: false });
    expect(file).toMatch(/main-\d{4}-\d{2}-\d{2}\.log$/);

    logging.createLogger('test').info({ n: 1 }, 'hello');
    expect(readLines(file)).toEqual([
      expect.objectContaining({ level: 30, module: 'test', n: 1, msg: 'hello' }),
    ]);
  });

  it('drops records below the level', () => {
    const file = logging.initLogging({ dir: tempDir(), level: 'warn', console: false });
    const log = logging.createLogger('test');
    log.info('no');
    log.debug('no');
    log.warn('yes');
    expect(readLines(file).map((line) => line['msg'])).toEqual(['yes']);
  });

  it('applies to loggers created before initLogging', () => {
    const early = logging.createLogger('early');
    const file = logging.initLogging({ dir: tempDir(), level: 'debug', console: false });
    early.debug('still logged');
    expect(readLines(file)).toEqual([expect.objectContaining({ msg: 'still logged' })]);
  });

  it('redacts secret-looking keys', () => {
    const file = logging.initLogging({ dir: tempDir(), level: 'info', console: false });
    logging
      .createLogger('test')
      .info(
        { apiKey: 'sk-1', agent: { token: 't-2', name: 'ok' }, headers: { authorization: 'b' } },
        'x',
      );
    const [line] = readLines(file);
    expect(line).toMatchObject({
      apiKey: '[redacted]',
      agent: { token: '[redacted]', name: 'ok' },
      headers: { authorization: '[redacted]' },
    });
    expect(readFileSync(file, 'utf8')).not.toMatch(/sk-1|t-2/);
  });

  it('redacts secret values in messages, fields and error stacks', () => {
    const file = logging.initLogging({ dir: tempDir(), level: 'info', console: false });
    const secret = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const log = logging.createLogger('test');
    log.info({ command: `claude --key ${secret}` }, `starting with ${secret}`);
    log.error({ err: new Error(`401 for key ${secret}`) }, 'request failed');
    log.warn({ env: { OPENAI_API_KEY: 'sk-proj-short' } }, 'nested');
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain(secret);
    expect(text).not.toContain('sk-proj-short');
    const [first, second] = readLines(file);
    expect(first).toMatchObject({
      msg: 'starting with [redacted]',
      command: 'claude --key [redacted]',
    });
    expect(second).toMatchObject({ err: { message: '401 for key [redacted]' } });
  });

  it('serialises errors with their stack', () => {
    const file = logging.initLogging({ dir: tempDir(), level: 'info', console: false });
    logging.createLogger('test').error({ err: new Error('boom') }, 'failed');
    const [line] = readLines(file);
    expect(line?.['err']).toMatchObject({ type: 'Error', message: 'boom' });
    expect((line?.['err'] as { stack: string }).stack).toContain('logging.test.ts');
  });

  it('deletes old log files and nothing else', () => {
    const dir = tempDir();
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const name of ['main-2020-01-01.log', 'other.log', 'main-2026-01-01.log.bak']) {
      writeFileSync(join(dir, name), '');
      utimesSync(join(dir, name), old, old);
    }
    writeFileSync(join(dir, 'main-2020-01-02.log'), ''); // old name, but written recently

    const file = logging.initLogging({ dir, level: 'info', console: false });
    expect(readdirSync(dir).sort()).toEqual(
      [
        'main-2020-01-02.log',
        'main-2026-01-01.log.bak',
        'other.log',
        file.slice(dir.length + 1),
      ].sort(),
    );
  });

  it('can only be initialised once', () => {
    logging.initLogging({ dir: tempDir(), level: 'info', console: false });
    expect(() => logging.initLogging({ dir: tempDir(), level: 'info', console: false })).toThrow(
      /already/,
    );
  });

  it('reads the level from VCODE_LOG_LEVEL', () => {
    expect(logging.levelFromEnv('info')).toBe('info');
    vi.stubEnv('VCODE_LOG_LEVEL', 'TRACE');
    expect(logging.levelFromEnv('info')).toBe('trace');
    vi.stubEnv('VCODE_LOG_LEVEL', 'loud');
    expect(logging.levelFromEnv('info')).toBe('info');
  });
});
