import { APP_NAME } from '@vcode/shared';
import { invoke, onEvent } from '@renderer/lib/ipc';
import { CircleArrowDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

function restartToUpdate() {
  invoke('app:restartToUpdate').catch((error: unknown) => {
    console.error('Failed to restart to update:', error);
    toast.error(`Couldn’t install the update. It installs the next time you quit ${APP_NAME}.`);
  });
}

/**
 * The status bar's "Restart to update" (P8-04), shown once an update has downloaded. A toast with
 * the same action says so when the download finishes while the app is open.
 */
export function UpdateButton() {
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe first, so a download that finishes during the read below isn't missed.
    const unsubscribe = onEvent('app:update', (state) => {
      setReady(state.ready);
      if (state.ready) {
        toast.info(`${APP_NAME} ${state.ready} is ready`, {
          description: `Restart ${APP_NAME} to install it.`,
          duration: Infinity,
          action: { label: 'Restart now', onClick: restartToUpdate },
        });
      }
    });
    invoke('app:getUpdate').then(
      (state) => setReady((current) => current ?? state.ready),
      (error: unknown) => console.error('Failed to load the update state:', error),
    );
    return unsubscribe;
  }, []);

  if (!ready) return null;
  return (
    <button
      type="button"
      onClick={restartToUpdate}
      title={`${APP_NAME} ${ready} has downloaded. Restart to install it.`}
      className="flex h-[18px] items-center gap-1 rounded-sm bg-primary px-1.5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      data-testid="update-button"
    >
      <CircleArrowDown className="size-3" />
      Restart to update
    </button>
  );
}
