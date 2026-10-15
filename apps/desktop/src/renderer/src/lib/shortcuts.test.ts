import { describe, expect, it, vi } from 'vitest';

vi.mock('./ipc', () => ({ invoke: vi.fn() }));
const { SHORTCUTS, shortcutFor, shortcutLabel } = await import('./shortcuts');

const key = (
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
) => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('shortcuts', () => {
  it('use Ctrl on Windows and Cmd on macOS', () => {
    expect(shortcutFor(key('T', { ctrl: true, shift: true }), false)).toBe('newTerminal');
    expect(shortcutFor(key('T', { meta: true, shift: true }), true)).toBe('newTerminal');
    expect(shortcutFor(key('T', { meta: true, shift: true }), false)).toBeNull();
    expect(shortcutFor(key('T', { ctrl: true, shift: true }), true)).toBeNull();
  });

  it('match the key case-insensitively and need the exact modifiers', () => {
    expect(shortcutFor(key('t', { ctrl: true, shift: true }), false)).toBe('newTerminal');
    expect(shortcutFor(key('PageDown', { ctrl: true }), false)).toBe('nextPanel');
    expect(shortcutFor(key('PageDown', { ctrl: true, shift: true }), false)).toBeNull();
    expect(shortcutFor(key('T', { ctrl: true, shift: true, alt: true }), false)).toBeNull();
  });

  it('leave the keys shells use alone', () => {
    for (const k of ['c', 'v', 'w', 't', 'd', 'z', 'l', 'r']) {
      expect(shortcutFor(key(k, { ctrl: true }), false)).toBeNull();
    }
    expect(shortcutFor(key('Tab', { ctrl: true }), false)).toBeNull();
  });

  it('are all different', () => {
    const combos = Object.values(SHORTCUTS).map((s) => `${s.mod}${s.shift}${s.key.toLowerCase()}`);
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('have labels for each OS', () => {
    expect(shortcutLabel('newTerminal', false)).toBe('Ctrl+Shift+T');
    expect(shortcutLabel('nextPanel', false)).toBe('Ctrl+PgDn');
    expect(shortcutLabel('toggleMaximize', true)).toBe('⌘⇧↩');
  });
});
