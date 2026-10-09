import type { AgentProvider, Credential, SetCredentialRequest } from '@vcode/shared';
import { useId } from 'react';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { cn } from '@renderer/lib/utils';

// The fields of an API key: name, provider, variable and the key itself. The key is typed in a
// password field and only ever sent to main; what comes back is metadata (V1 doc §16).

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CredentialDraft {
  name: string;
  provider: AgentProvider['id'];
  envVar: string;
  secret: string;
}

export function emptyDraft(provider: AgentProvider, takenNames: string[] = []): CredentialDraft {
  let name = `${provider.displayName} key`;
  for (let n = 2; takenNames.includes(name); n++) {
    name = `${provider.displayName} key ${n}`;
  }
  return { name, provider: provider.id, envVar: provider.apiKeyEnv ?? '', secret: '' };
}

export function draftOf(credential: Credential): CredentialDraft {
  return { ...credential, secret: '' };
}

/** Why the draft can't be saved yet, or null. `editing`: a blank key keeps the saved one. */
export function draftProblem(draft: CredentialDraft, editing: boolean): string | null {
  if (!draft.name.trim()) return 'Enter a name.';
  if (!ENV_NAME.test(draft.envVar)) return 'Enter a variable name, e.g. ANTHROPIC_API_KEY.';
  if (!editing && !draft.secret.trim()) return 'Enter the key.';
  return null;
}

export function toRequest(draft: CredentialDraft, id?: string): SetCredentialRequest {
  const secret = draft.secret.trim();
  return {
    ...(id ? { id } : {}),
    name: draft.name.trim(),
    provider: draft.provider,
    envVar: draft.envVar.trim(),
    ...(secret ? { secret } : {}),
  };
}

export function CredentialFields({
  draft,
  onChange,
  providers,
  editing = false,
  className,
}: {
  draft: CredentialDraft;
  onChange: (draft: CredentialDraft) => void;
  providers: AgentProvider[];
  editing?: boolean;
  className?: string;
}) {
  const ids = useId();
  const set = (patch: Partial<CredentialDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className={cn('grid gap-3', className)}>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-name`}>Key name</Label>
          <Input
            id={`${ids}-name`}
            value={draft.name}
            maxLength={100}
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-provider`}>For</Label>
          <select
            id={`${ids}-provider`}
            value={draft.provider}
            onChange={(event) => {
              const next = providers.find((p) => p.id === event.target.value);
              if (!next) return;
              // Follow the provider's variable unless the user typed their own.
              const followed = providers.some((p) => p.apiKeyEnv === draft.envVar);
              set({
                provider: next.id,
                ...(followed || !draft.envVar ? { envVar: next.apiKeyEnv ?? '' } : {}),
              });
            }}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} className="bg-popover text-popover-foreground">
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-env`}>Environment variable</Label>
        <Input
          id={`${ids}-env`}
          value={draft.envVar}
          maxLength={100}
          spellCheck={false}
          placeholder="ANTHROPIC_API_KEY"
          className="font-mono"
          onChange={(event) => set({ envVar: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-secret`}>{editing ? 'New key' : 'Key'}</Label>
        <Input
          id={`${ids}-secret`}
          type="password"
          value={draft.secret}
          autoComplete="off"
          spellCheck={false}
          placeholder={editing ? 'Leave blank to keep the saved key' : 'Paste the key'}
          className="font-mono"
          onChange={(event) => set({ secret: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Encrypted for your user account on this computer and only given to the agent when it
          starts. Vcode never shows it again.
        </p>
      </div>
    </div>
  );
}
