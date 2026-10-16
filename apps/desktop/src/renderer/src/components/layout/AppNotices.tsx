import { onEvent } from '@renderer/lib/ipc';
import { runShortcut } from '@renderer/lib/shortcuts';
import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Shows `app:notice` events from main as toasts (errors stay until dismissed), and carries out
 * `app:command`s from the tray.
 */
export function AppNotices() {
  useEffect(
    () =>
      onEvent('app:command', ({ command }) => {
        if (command === 'newTerminal' && !runShortcut('newTerminalDialog')) {
          toast.info('Select an active project to open a terminal in it.');
        }
      }),
    [],
  );
  useEffect(
    () =>
      onEvent('app:notice', ({ level, message }) => {
        if (level === 'error') {
          toast.error(message, { duration: Infinity });
        } else if (level === 'warning') {
          toast.warning(message);
        } else {
          toast.info(message);
        }
      }),
    [],
  );
  return null;
}
