import type {
  Agent,
  AgentDetection,
  AgentProvider,
  CreateAgentRequest,
  DetectAgentRequest,
  Project,
} from '@vcode/shared';
import { CircleAlert, CircleCheck, Loader2, RotateCw } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Textarea } from '@renderer/components/ui/textarea';
import { errorMessage, FormError, useSubmit } from '@renderer/lib/form';
import { invoke } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';

// Add / Edit Agent (P4-01, P4-02, V1 doc §14): provider, name, scope, executable
// (auto-detected, can be overridden), extra arguments, model, role and instructions. The
// provider list comes from main (`agents:providers`), so a new adapter shows up here without
// UI changes. An agent's provider can't be changed once it is saved.

/** Everything the form sets but the provider. */
export type AgentSettings = Omit<CreateAgentRequest, 'adapter'>;

interface AgentDialogProps {
  open: boolean;
  /** The agent to edit, or null to add a new one. */
  agent: Agent | null;
  /** The selected project, if it is active: the agent can be saved for it only. */
  project: Project | null;
  /** `adapter` is the chosen provider; it can't change when editing. */
  onSave: (adapter: AgentProvider['id'], settings: AgentSettings) => Promise<void>;
  onClose: () => void;
}

export function AgentDialog({ open, agent, project, onSave, onClose }: AgentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open && <AgentLoader key={agent?.id} agent={agent} project={project} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

type Providers = { list: AgentProvider[] } | { error: string } | null;

function AgentLoader({
  agent,
  project,
  onSave,
}: Pick<AgentDialogProps, 'agent' | 'project' | 'onSave'>) {
  const [providers, setProviders] = useState<Providers>(null);

  useEffect(() => {
    let cancelled = false;
    invoke('agents:providers').then(
      (list) => !cancelled && setProviders({ list }),
      (error: unknown) => !cancelled && setProviders({ error: errorMessage(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const editing = agent !== null;
  if (!providers) {
    return <DialogHeading editing={editing} />;
  }
  if ('error' in providers || providers.list.length === 0) {
    return (
      <>
        <DialogHeading editing={editing} />
        <FormError message={'error' in providers ? providers.error : 'No providers available.'} />
      </>
    );
  }
  return <AgentForm providers={providers.list} agent={agent} project={project} onSave={onSave} />;
}

function DialogHeading({ editing }: { editing: boolean }) {
  return (
    <DialogHeader>
      <DialogTitle>{editing ? 'Edit agent' : 'Add agent'}</DialogTitle>
      <DialogDescription>
        {editing
          ? 'Changes apply the next time the agent starts.'
          : 'A coding CLI that Vcode can start in a terminal. It signs in with its own login.'}
      </DialogDescription>
    </DialogHeader>
  );
}

/** One item per line; blank lines are dropped. */
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The agent's provider; one that has no adapter any more is shown as it was saved. */
function providerOf(agent: Agent, providers: AgentProvider[]): AgentProvider {
  return (
    providers.find((p) => p.id === agent.adapter) ?? {
      id: agent.adapter,
      displayName: agent.adapter,
      defaultExecutable: agent.executable,
      supportsInstructions: true,
    }
  );
}

function AgentForm({
  providers,
  agent,
  project,
  onSave,
}: {
  providers: AgentProvider[];
  agent: Agent | null;
  project: Project | null;
  onSave: AgentDialogProps['onSave'];
}) {
  const ids = useId();
  const editing = agent !== null;
  const [provider, setProvider] = useState(() =>
    agent ? providerOf(agent, providers) : providers[0],
  );
  const [name, setName] = useState(agent?.name ?? provider.displayName);
  const [nameEdited, setNameEdited] = useState(editing);
  const [scope, setScope] = useState<'global' | 'project'>(agent?.projectId ? 'project' : 'global');
  // Blank means the provider's default, so the default isn't saved as an override.
  const [executable, setExecutable] = useState(
    agent && agent.executable !== provider.defaultExecutable ? agent.executable : '',
  );
  const [args, setArgs] = useState(agent?.args.join('\n') ?? '');
  const [model, setModel] = useState(agent?.model ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  const [instructions, setInstructions] = useState(agent?.instructions ?? '');
  // An agent being edited belongs to the selected project (the list shows no others).
  const scopeProjectId = project?.id ?? agent?.projectId ?? null;

  // Auto-detect: runs for the agent's CLI at first, and again whenever the provider changes,
  // the executable field loses focus with a new value, or the user asks.
  const [probe, setProbe] = useState<DetectAgentRequest>({
    adapter: provider.id,
    executable: executable || undefined,
  });
  const detection = useDetection(probe);
  // Always a new object, so detecting the same values again runs again.
  const detect = (request: DetectAgentRequest) => setProbe(request);
  const probedExecutable = probe.executable ?? '';

  const changeProvider = (id: string) => {
    const next = providers.find((p) => p.id === id) ?? provider;
    setProvider(next);
    if (!nameEdited) {
      setName(next.displayName);
    }
    detect({ adapter: next.id, executable: executable.trim() || undefined });
  };

  const { pending, error, submit } = useSubmit(() =>
    onSave(provider.id, {
      projectId: scope === 'project' ? scopeProjectId : null,
      name: name.trim(),
      // '' (not undefined) so an edit can go back to the default.
      executable: executable.trim(),
      args: lines(args),
      model: model.trim() || null,
      role: role.trim() || null,
      instructions: instructions.trim() || null,
    }),
  );

  const options = providers.includes(provider) ? providers : [provider, ...providers];

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeading editing={editing} />

      <Field label="Provider" htmlFor={`${ids}-provider`}>
        <select
          id={`${ids}-provider`}
          value={provider.id}
          disabled={editing}
          title={editing ? "An agent's provider can't be changed" : undefined}
          onChange={(event) => changeProvider(event.target.value)}
          className={cn(
            'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none dark:bg-input/30',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {options.map((p) => (
            <option key={p.id} value={p.id} className="bg-popover text-popover-foreground">
              {p.displayName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Name" htmlFor={`${ids}-name`}>
        <Input
          id={`${ids}-name`}
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
            setNameEdited(true);
          }}
        />
      </Field>

      <Field label="Available in" labelId={`${ids}-scope`}>
        <div
          role="radiogroup"
          aria-labelledby={`${ids}-scope`}
          className="grid grid-cols-2 gap-1 rounded-md border p-1"
        >
          <ScopeOption checked={scope === 'global'} onSelect={() => setScope('global')}>
            All projects
          </ScopeOption>
          <ScopeOption
            checked={scope === 'project'}
            disabled={!scopeProjectId}
            title={scopeProjectId ? undefined : 'Select an active project first'}
            onSelect={() => setScope('project')}
          >
            {project ? `Only “${project.name}”` : 'This project only'}
          </ScopeOption>
        </div>
      </Field>

      <Field
        label="Executable"
        htmlFor={`${ids}-executable`}
        hint={`Leave blank to use “${provider.defaultExecutable}” from PATH, or enter a command or full path.`}
      >
        <div className="flex gap-2">
          <Input
            id={`${ids}-executable`}
            value={executable}
            placeholder={provider.defaultExecutable}
            spellCheck={false}
            className="font-mono"
            onChange={(event) => setExecutable(event.target.value)}
            onBlur={() => {
              if (executable.trim() !== probedExecutable) {
                detect({ adapter: provider.id, executable: executable.trim() || undefined });
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={detection.pending}
            onClick={() =>
              detect({ adapter: provider.id, executable: executable.trim() || undefined })
            }
          >
            <RotateCw className={cn(detection.pending && 'animate-spin')} />
            Detect
          </Button>
        </div>
        <DetectionStatus
          detection={detection}
          displayName={provider.displayName}
          editing={editing}
        />
      </Field>

      <Field
        label="Model"
        htmlFor={`${ids}-model`}
        hint="Optional. Leave blank for the CLI's default."
      >
        <Input
          id={`${ids}-model`}
          value={model}
          maxLength={200}
          spellCheck={false}
          onChange={(event) => setModel(event.target.value)}
        />
      </Field>

      <Field
        label="Role"
        htmlFor={`${ids}-role`}
        hint={provider.supportsInstructions ? 'Optional, e.g. “Backend reviewer”.' : undefined}
      >
        <Input
          id={`${ids}-role`}
          value={role}
          maxLength={200}
          disabled={!provider.supportsInstructions}
          onChange={(event) => setRole(event.target.value)}
        />
      </Field>

      <Field
        label="Instructions"
        htmlFor={`${ids}-instructions`}
        hint={
          provider.supportsInstructions
            ? "Optional. Added to the agent's instructions when it starts."
            : `${provider.displayName} can't take a role or instructions when it starts. Put project instructions in the files it reads itself (e.g. GEMINI.md).`
        }
      >
        <Textarea
          id={`${ids}-instructions`}
          value={instructions}
          maxLength={20_000}
          disabled={!provider.supportsInstructions}
          className="max-h-48"
          onChange={(event) => setInstructions(event.target.value)}
        />
      </Field>

      <Field
        label="Extra arguments"
        htmlFor={`${ids}-args`}
        hint="Optional. One per line, passed to the CLI as they are."
      >
        <Textarea
          id={`${ids}-args`}
          value={args}
          spellCheck={false}
          className="max-h-32 font-mono"
          onChange={(event) => setArgs(event.target.value)}
        />
      </Field>

      <FormError message={error} />

      <DialogFooter>
        <Button type="submit" disabled={pending || name.trim().length === 0}>
          {editing ? (pending ? 'Saving…' : 'Save') : pending ? 'Adding…' : 'Add agent'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
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

function ScopeOption({
  checked,
  disabled,
  title,
  onSelect,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={cn(
        'truncate rounded px-2 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        checked ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground',
        !checked && !disabled && 'hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
    </button>
  );
}

interface Detection {
  pending: boolean;
  result: AgentDetection | null;
  error: string | null;
}

/** Runs `agents:detect` for each new probe; a newer probe replaces an older one's result. */
function useDetection(probe: DetectAgentRequest): Detection {
  const [done, setDone] = useState<{
    probe: DetectAgentRequest;
    result: AgentDetection | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke('agents:detect', probe).then(
      (result) => !cancelled && setDone({ probe, result, error: null }),
      (error: unknown) =>
        !cancelled && setDone({ probe, result: null, error: errorMessage(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [probe]);

  return done?.probe === probe
    ? { pending: false, result: done.result, error: done.error }
    : { pending: true, result: null, error: null };
}

function DetectionStatus({
  detection,
  displayName,
  editing,
}: {
  detection: Detection;
  displayName: string;
  editing: boolean;
}) {
  const { pending, result, error } = detection;
  if (pending) {
    return (
      <StatusLine icon={<Loader2 className="animate-spin" />}>
        Looking for {displayName}…
      </StatusLine>
    );
  }
  if (result?.status === 'ready') {
    return (
      <StatusLine icon={<CircleCheck className="text-success" />}>
        Found <span className="font-mono break-all">{result.path}</span>
        {result.version && <> · version {result.version}</>}
      </StatusLine>
    );
  }
  return (
    <StatusLine icon={<CircleAlert className="text-warning" />}>
      {result?.message ?? error}{' '}
      <span className="text-muted-foreground">
        You can still {editing ? 'save' : 'add'} it and fix this later.
      </span>
    </StatusLine>
  );
}

function StatusLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-1.5 text-xs [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0"
    >
      {icon}
      <span>{children}</span>
    </p>
  );
}
