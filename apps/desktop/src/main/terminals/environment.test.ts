import { describe, expect, it, vi } from 'vitest';
import { prepareTerminalEnvironment } from './environment';

vi.mock('electron', () => ({ shell: {} }));

describe('prepareTerminalEnvironment', () => {
  it("drops Electron's variables and marks the terminal", () => {
    const env = prepareTerminalEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/Users/me',
        ELECTRON_RUN_AS_NODE: '1',
        electron_enable_logging: '1',
        ELECTRON_RENDERER_URL: 'http://localhost:5173',
        TERM_PROGRAM: 'Apple_Terminal',
        NOT_ELECTRON_X: 'kept',
      },
      '1.2.3',
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      NOT_ELECTRON_X: 'kept',
      TERM_PROGRAM: 'Vcode',
      TERM_PROGRAM_VERSION: '1.2.3',
      COLORTERM: 'truecolor',
    });
  });

  it('does not change its input', () => {
    const base = { ELECTRON_X: '1' };
    prepareTerminalEnvironment(base, '1');
    expect(base).toEqual({ ELECTRON_X: '1' });
  });
});
