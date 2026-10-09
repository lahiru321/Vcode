import { useState, type FormEvent } from 'react';

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
