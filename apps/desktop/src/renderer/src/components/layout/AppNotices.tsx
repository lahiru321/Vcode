import { onEvent } from '@renderer/lib/ipc';
import { useEffect } from 'react';
import { toast } from 'sonner';

/** Shows `app:notice` events from main as toasts. Errors stay until dismissed. */
export function AppNotices() {
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
