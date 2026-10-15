import { useState, type FormEvent, type ReactNode } from 'react';
import { Label } from '@renderer/components/ui/label';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A submit handler that tracks pending state and shows the IPC error message, if any. */
export function useSubmit(action: () => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };
  return { pending, error, submit };
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

/** A labelled form field with an optional hint below it. */
export function Field({
  label,
  htmlFor,
  labelId,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  labelId?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label id={labelId} htmlFor={htmlFor}>
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
