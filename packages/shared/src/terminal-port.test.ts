import { describe, expect, it } from 'vitest';
import { MAX_TERMINAL_INPUT, parseTerminalClientMessage } from './terminal-port';

describe('parseTerminalClientMessage', () => {
  it('accepts input and resize', () => {
    expect(parseTerminalClientMessage({ type: 'input', data: 'ls\r' })).toEqual({
      type: 'input',
      data: 'ls\r',
    });
    expect(parseTerminalClientMessage({ type: 'resize', cols: 120, rows: 40 })).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    });
  });

  it('drops extra fields', () => {
    expect(parseTerminalClientMessage({ type: 'input', data: 'x', sessionId: 'other' })).toEqual({
      type: 'input',
      data: 'x',
    });
  });

  it.each([
    null,
    'input',
    42,
    {},
    { type: 'input' },
    { type: 'input', data: 5 },
    { type: 'input', data: 'x'.repeat(MAX_TERMINAL_INPUT + 1) },
    { type: 'resize', cols: 80 },
    { type: 'resize', cols: 1, rows: 24 },
    { type: 'resize', cols: 80, rows: 0 },
    { type: 'resize', cols: 1001, rows: 24 },
    { type: 'resize', cols: 80.5, rows: 24 },
    { type: 'resize', cols: '80', rows: '24' },
    { type: 'kill' },
    { type: 'spawn', file: 'calc.exe' },
  ])('refuses %j', (message) => {
    expect(parseTerminalClientMessage(message)).toBeNull();
  });
});
