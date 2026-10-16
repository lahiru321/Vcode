import { APP_NAME, type Settings } from '@vcode/shared';
import { useEffect, useId, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { errorMessage, FormError } from '@renderer/lib/form';
import { invoke } from '@renderer/lib/ipc';

// App settings (P7-02 onwards). Each change is saved as soon as it's made.

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Changes are saved right away.</DialogDescription>
        </DialogHeader>
        {open && <SettingsForm />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm() {
  const ids = useId();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke('settings:get').then(
      (loaded) => !cancelled && setSettings(loaded),
      (err: unknown) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const change = (patch: Partial<Settings>) => {
    setError(null);
    invoke('settings:set', patch).then(setSettings, (err: unknown) => setError(errorMessage(err)));
  };

  if (!settings) {
    return <FormError message={error} />;
  }
  return (
    <div className="grid gap-4">
      <label htmlFor={`${ids}-tray`} className="flex cursor-pointer items-start gap-3">
        <input
          id={`${ids}-tray`}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={settings.closeToTray}
          onChange={(event) => change({ closeToTray: event.target.checked })}
        />
        <span className="grid gap-1">
          <span className="text-sm font-medium">
            Keep running in the tray when the window closes
          </span>
          <span className="text-xs text-muted-foreground">
            Agents keep working; open the window again from the tray icon. Off: closing the window
            quits, asking first if agents are running.
          </span>
        </span>
      </label>
      <label htmlFor={`${ids}-notify`} className="flex cursor-pointer items-start gap-3">
        <input
          id={`${ids}-notify`}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={settings.notifications}
          onChange={(event) => change({ notifications: event.target.checked })}
        />
        <span className="grid gap-1">
          <span className="text-sm font-medium">Notify me about agents</span>
          <span className="text-xs text-muted-foreground">
            When an agent finishes, fails, or seems to be waiting for input while {APP_NAME} isn’t
            in front. Click a notification to go to its terminal.
          </span>
        </span>
      </label>
      <FormError message={error} />
    </div>
  );
}
