import { useEffect, useRef } from 'react';
import { invoke } from './ipc';

// Keyboard shortcuts (P5-06). "Mod" is CommandOrControl: Cmd on macOS, Ctrl elsewhere. They
// avoid keys shells and CLIs use themselves (Ctrl+C, Ctrl+W, Ctrl+T, …), following Windows
// Terminal and VS Code. One listener on the window, in the capture phase, sees a shortcut before
// the focused terminal does, and only takes it when something on screen handles it.

export type ShortcutId =
  | 'newTerminal'
  | 'newTerminalDialog'
  | 'closeTerminal'
  | 'toggleMaximize'
  | 'nextPanel'
  | 'previousPanel'
  | 'find'
  | 'copy'
  | 'paste';

interface Keys {
  mod: boolean;
  shift: boolean;
  /** `KeyboardEvent.key`, compared case-insensitively. */
  key: string;
}

export const SHORTCUTS: Record<ShortcutId, Keys & { description: string }> = {
  newTerminal: { mod: true, shift: true, key: 'T', description: 'New shell' },
  newTerminalDialog: { mod: true, shift: true, key: 'N', description: 'New terminal…' },
  closeTerminal: { mod: true, shift: true, key: 'W', description: 'Close terminal' },
  toggleMaximize: { mod: true, shift: true, key: 'Enter', description: 'Maximize / restore' },
  nextPanel: { mod: true, shift: false, key: 'PageDown', description: 'Next terminal' },
  previousPanel: { mod: true, shift: false, key: 'PageUp', description: 'Previous terminal' },
  find: { mod: true, shift: true, key: 'F', description: 'Find' },
  copy: { mod: true, shift: true, key: 'C', description: 'Copy' },
  paste: { mod: true, shift: true, key: 'V', description: 'Paste' },
};

let isMac = false;

/** Asks main which OS this is; until it answers, shortcuts use Ctrl. */
function loadPlatform(): void {
  invoke('app:getInfo').then(
    (info) => (isMac = info.platform === 'darwin'),
    () => undefined,
  );
}

type KeyState = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** The shortcut `event` presses, if any. */
export function shortcutFor(event: KeyState, mac: boolean): ShortcutId | null {
  const found = (Object.entries(SHORTCUTS) as [ShortcutId, Keys][]).find(([, keys]) =>
    matches(event, keys, mac),
  );
  return found ? found[0] : null;
}

function matches(event: KeyState, keys: Keys, mac: boolean): boolean {
  const mod = mac ? event.metaKey : event.ctrlKey;
  const other = mac ? event.ctrlKey : event.metaKey;
  return (
    mod === keys.mod &&
    !other &&
    !event.altKey &&
    event.shiftKey === keys.shift &&
    event.key.toLowerCase() === keys.key.toLowerCase()
  );
}

/** "Ctrl+Shift+T" here, "⌘⇧T" on macOS. */
export function shortcutLabel(id: ShortcutId, mac = isMac): string {
  const { mod, shift, key } = SHORTCUTS[id];
  const name = key === 'PageDown' ? 'PgDn' : key === 'PageUp' ? 'PgUp' : key;
  if (mac) return `${mod ? '⌘' : ''}${shift ? '⇧' : ''}${key === 'Enter' ? '↩' : name}`;
  return [mod && 'Ctrl', shift && 'Shift', name].filter(Boolean).join('+');
}

/** Handlers by shortcut; the latest registration wins, so a newer view takes over. */
const handlers = new Map<ShortcutId, (() => void)[]>();

/** Runs `handler` on the shortcut while the calling component is mounted and `enabled`. */
export function useShortcut(id: ShortcutId, handler: () => void, enabled = true): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const run = () => latest.current();
    handlers.set(id, [...(handlers.get(id) ?? []), run]);
    return () =>
      void handlers.set(
        id,
        (handlers.get(id) ?? []).filter((h) => h !== run),
      );
  }, [id, enabled]);
}

/** Runs what the shortcut would do (e.g. for a tray menu item); false if nothing handles it now. */
export function runShortcut(id: ShortcutId): boolean {
  const handler = handlers.get(id)?.at(-1);
  handler?.();
  return handler !== undefined;
}

/** While a dialog or menu is open, keys belong to it. */
function inOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role=dialog], [role=menu]') !== null;
}

/** Install once, at the app root. */
export function useShortcutListener(): void {
  useEffect(() => {
    loadPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || inOverlay(event.target)) return;
      const id = shortcutFor(event, isMac);
      const handler = id && handlers.get(id)?.at(-1);
      if (!handler) return;
      // Before the terminal sees it: the shell gets nothing.
      event.preventDefault();
      event.stopPropagation();
      handler();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
