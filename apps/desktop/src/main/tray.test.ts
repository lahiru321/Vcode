import { describe, expect, it, vi } from 'vitest';
import { iconPixel, runningSummary, trayMenuTemplate, type TrayActions } from './tray';

vi.mock('electron', () => ({ Menu: {}, nativeImage: {}, Tray: class {}, shell: {} }));
vi.mock('./ipc', () => ({ broadcastEvent: vi.fn() }));

const actions: TrayActions = { toggleWindow: vi.fn(), newTerminal: vi.fn(), quit: vi.fn() };

describe('runningSummary', () => {
  it('counts agents', () => {
    expect([0, 1, 3].map(runningSummary)).toEqual([
      'No agents running',
      '1 agent running',
      '3 agents running',
    ]);
  });
});

describe('trayMenuTemplate', () => {
  it('lists running agents, then Show / Hide, New Terminal and Quit', () => {
    const menu = trayMenuTemplate(
      [
        { sessionId: 'a', agentName: 'Claude Code', projectName: 'shop', status: 'working' },
        { sessionId: 'b', agentName: 'Gemini', projectName: 'blog', status: 'waiting' },
      ],
      true,
      actions,
    );
    expect(menu.map((item) => item.label ?? item.type)).toEqual([
      '2 agents running',
      '    Claude Code · shop (working)',
      '    Gemini · blog (waiting for input)',
      'separator',
      'Hide Vcode',
      'New Terminal…',
      'separator',
      'Quit Vcode',
    ]);
    expect(menu.slice(0, 3).every((item) => item.enabled === false)).toBe(true);
    expect(menu.at(-1)?.click).toBe(actions.quit);
  });

  it('offers Show when the window is hidden', () => {
    const menu = trayMenuTemplate([], false, actions);
    expect(menu.map((item) => item.label ?? item.type)).toEqual([
      'No agents running',
      'separator',
      'Show Vcode',
      'New Terminal…',
      'separator',
      'Quit Vcode',
    ]);
  });
});

describe('iconPixel', () => {
  const at = (x: number, y: number, running = false) => iconPixel(x, y, running).join(',');

  it('draws a rounded square with a white prompt', () => {
    expect(at(0, 0)).toBe('0,0,0,0'); // rounded corner
    expect(at(8, 2)).toBe('37,99,235,255'); // blue
    expect(at(6, 7)).toBe('255,255,255,255'); // tip of ">"
  });

  it('adds a green dot, set apart by a clear ring, while agents run', () => {
    expect(at(12, 12, true)).toBe('34,197,94,255');
    expect(at(12, 9, true)).toBe('0,0,0,0');
    expect(at(12, 12, false)).not.toBe('34,197,94,255');
  });
});
