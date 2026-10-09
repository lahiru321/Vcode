import type { AgentProvider, Credential } from '@vcode/shared';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { errorMessage, FormError, useSubmit } from '@renderer/lib/form';
import { invoke } from '@renderer/lib/ipc';
import {
  CredentialFields,
  draftOf,
  draftProblem,
  emptyDraft,
  toRequest,
  type CredentialDraft,
} from './CredentialForm';

// API keys (P4-05, V1 doc §16): metadata only. Keys can be added, renamed, replaced and
// deleted, never read back.

interface ApiKeysDialogProps {
  open: boolean;
  onClose: () => void;
  /** After any change: agents may now use a different key, or none. */
  onChanged: () => void;
}

export function ApiKeysDialog({ open, onClose, onChanged }: ApiKeysDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API keys</DialogTitle>
          <DialogDescription>
            For CLIs that read a key from an environment variable. Agents without one use the CLI’s
            own login.
          </DialogDescription>
        </DialogHeader>
        {open && <ApiKeys onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}

type Editing = { kind: 'new' } | { kind: 'edit'; credential: Credential } | null;

function ApiKeys({ onChanged }: { onChanged: () => void }) {
  const [keys, setKeys] = useState<Credential[] | null>(null);
  const [providers, setProviders] = useState<AgentProvider[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Credential | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([invoke('credentials:list'), invoke('agents:providers')]).then(
        ([list, providerList]) => {
          setKeys(list);
          setProviders(providerList);
          setLoadError(null);
        },
        (error: unknown) => setLoadError(errorMessage(error)),
      ),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const changed = async () => {
    await reload();
    onChanged();
  };

  if (loadError) {
    return <FormError message={loadError} />;
  }
  if (!keys) {
    return null;
  }

  const providerName = (id: string) => providers.find((p) => p.id === id)?.displayName ?? id;

  return (
    <div className="grid gap-3">
      {keys.length === 0 && editing?.kind !== 'new' && (
        <p className="flex items-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          <KeyRound className="size-4" />
          No API keys saved.
        </p>
      )}

      {keys.map((key) =>
        editing?.kind === 'edit' && editing.credential.id === key.id ? (
          <KeyEditor
            key={key.id}
            providers={providers}
            credential={key}
            takenNames={keys.map((k) => k.name)}
            onDone={async (saved) => {
              setEditing(null);
              if (saved) await changed();
            }}
          />
        ) : (
          <div key={key.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{key.name}</span>
                {key.status === 'unavailable' && (
                  <Badge
                    variant="destructive"
                    title="This computer can't decrypt it. Enter the key again."
                  >
                    Can’t decrypt
                  </Badge>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {providerName(key.provider)} · <span className="font-mono">{key.envVar}</span> ·{' '}
                {key.agentCount === 1 ? '1 agent' : `${key.agentCount} agents`}
              </div>
            </div>
            {deleting?.id === key.id ? (
              <ConfirmDelete
                credential={key}
                onDone={async (deleted) => {
                  setDeleting(null);
                  if (deleted) await changed();
                }}
              />
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Edit ${key.name}`}
                  onClick={() => setEditing({ kind: 'edit', credential: key })}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${key.name}`}
                  onClick={() => setDeleting(key)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        ),
      )}

      {editing?.kind === 'new' ? (
        <KeyEditor
          providers={providers}
          credential={null}
          takenNames={keys.map((k) => k.name)}
          onDone={async (saved) => {
            setEditing(null);
            if (saved) await changed();
          }}
        />
      ) : (
        providers.length > 0 && (
          <Button variant="outline" className="w-fit" onClick={() => setEditing({ kind: 'new' })}>
            <Plus />
            Add API key
          </Button>
        )
      )}
    </div>
  );
}

function KeyEditor({
  providers,
  credential,
  takenNames,
  onDone,
}: {
  providers: AgentProvider[];
  credential: Credential | null;
  takenNames: string[];
  onDone: (saved: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CredentialDraft>(() =>
    credential ? draftOf(credential) : emptyDraft(providers[0]!, takenNames),
  );
  const editing = credential !== null;
  const problem = draftProblem(draft, editing);
  const { pending, error, submit } = useSubmit(async () => {
    const saved = await invoke('credentials:set', toRequest(draft, credential?.id));
    toast.success(`${editing ? 'Saved' : 'Added'} “${saved.name}”`);
    await onDone(true);
  });

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md border bg-muted/30 p-3">
      <CredentialFields draft={draft} onChange={setDraft} providers={providers} editing={editing} />
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={() => void onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || problem !== null} title={problem ?? undefined}>
          {pending ? 'Saving…' : editing ? 'Save' : 'Add key'}
        </Button>
      </div>
    </form>
  );
}

function ConfirmDelete({
  credential,
  onDone,
}: {
  credential: Credential;
  onDone: (deleted: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const remove = async () => {
    setPending(true);
    try {
      await invoke('credentials:delete', { id: credential.id });
      toast.success(`Deleted “${credential.name}”`, {
        description:
          credential.agentCount > 0 ? 'Its agents now use the CLI’s own login.' : undefined,
      });
      await onDone(true);
    } catch (err) {
      toast.error(`Could not delete “${credential.name}”`, { description: errorMessage(err) });
      await onDone(false);
    }
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => void onDone(false)}>
        Keep
      </Button>
      <Button variant="destructive" size="sm" disabled={pending} onClick={() => void remove()}>
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
    </div>
  );
}
