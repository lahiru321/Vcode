import { describe, expect, it, vi } from 'vitest';
import { dotPixel, runningSummary, trayMenuTemplate, type TrayActions } from './tray';

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

describe('dotPixel', () => {
  it('puts a green dot in the bottom-right corner, with a clear ring around it', () => {
    expect(dotPixel(12, 12, 16)).toBe('dot');
    expect(dotPixel(12, 8, 16)).toBe('ring');
    expect(dotPixel(4, 4, 16)).toBeNull();
    // Scales with the icon.
    expect(dotPixel(24, 24, 32)).toBe('dot');
    expect(dotPixel(8, 8, 32)).toBeNull();
  });
});
