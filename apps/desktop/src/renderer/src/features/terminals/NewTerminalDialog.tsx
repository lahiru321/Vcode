import type { Agent, Project, TerminalSession, Workspace } from '@vcode/shared';
import { Bot, Loader2, TerminalSquare } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
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
import { NativeOption, NativeSelect } from '@renderer/components/ui/native-select';
import { useProjects } from '@renderer/features/projects/ProjectsProvider';
import { errorMessage, Field, FormError, useSubmit } from '@renderer/lib/form';
import { invoke } from '@renderer/lib/ipc';
import { INITIAL_SIZE } from './useProjectTerminals';

// New terminal (P5-02, V1 doc §11): pick the project, the workspace in it, and what runs there —
// a plain shell or one of the agents available to that project (global or its own).

const SHELL = 'shell';

interface NewTerminalDialogProps {
  open: boolean;
  /** The project on screen; the dialog starts with it selected. */
  project: Project;
  /** The workspace to start with (one of `project`'s); its `main` one if not given. */
  workspaceId?: string;
  /** Called once the terminal is running in `projectId`. */
  onCreated: (terminal: TerminalSession, projectId: string) => void;
  /** Called after an agent was started or failed to, since that records its CLI status. */
  onAgentLaunched: () => void;
  onClose: () => void;
}

export function NewTerminalDialog({ open, onClose, ...props }: NewTerminalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {open && <NewTerminalForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

type Choices = { workspaces: Workspace[]; agents: Agent[] } | { error: string } | null;

/** The project's workspaces and agents, loaded again whenever the project changes. */
function useChoices(projectId: string): Choices {
  const [choices, setChoices] = useState<{ projectId: string; value: Choices }>({
    projectId,
    value: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([invoke('workspaces:list', { projectId }), invoke('agents:list', { projectId })])
      .then(
        ([workspaces, agents]) => ({ workspaces, agents }),
        (error: unknown) => ({ error: errorMessage(error) }),
      )
      .then((value) => !cancelled && setChoices({ projectId, value }));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Nothing (still loading) rather than the previous project's lists.
  return choices.projectId === projectId ? choices.value : null;
}

function agentLabel(agent: Agent): string {
  const scope = agent.projectId ? ' · this project' : '';
  const status =
    agent.status === 'not_found'
      ? ' · CLI not found'
      : agent.status === 'error'
        ? ' · CLI failed'
        : '';
  return `${agent.name}${scope}${status}`;
}

function NewTerminalForm({
  project,
  workspaceId: initialWorkspaceId,
  onCreated,
  onAgentLaunched,
}: Omit<NewTerminalDialogProps, 'open' | 'onClose'>) {
  const ids = useId();
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState(project.id);
  const choices = useChoices(projectId);
  // null: the project's first workspace (main) once loaded.
  const [workspaceId, setWorkspaceId] = useState<string | null>(initialWorkspaceId ?? null);
  const [run, setRun] = useState(SHELL);
  const [title, setTitle] = useState('');

  const loaded = choices && 'workspaces' in choices ? choices : null;
  const workspace = loaded?.workspaces.find((w) => w.id === workspaceId) ?? loaded?.workspaces[0];
  // An agent of the previous project isn't offered here; fall back to the shell.
  const agent = loaded?.agents.find((a) => a.id === run) ?? null;
  // Archived projects can't open terminals. The one on screen is always active here.
  const options = projects.filter((p) => p.status === 'active');

  const changeProject = (id: string) => {
    setProjectId(id);
    setWorkspaceId(null);
  };

  const { pending, error, submit } = useSubmit(async () => {
    if (!workspace) return;
    try {
      const terminal = await invoke('terminals:create', {
        projectId,
        workspaceId: workspace.id,
        agentId: agent?.id,
        title: title.trim() || undefined,
        ...INITIAL_SIZE,
      });
      onCreated(terminal, projectId);
    } finally {
      if (agent) onAgentLaunched();
    }
  });

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New terminal</DialogTitle>
        <DialogDescription>
          Opens in its own panel. Run a plain shell, or start one of your agents in it.
        </DialogDescription>
      </DialogHeader>

      <Field label="Project" htmlFor={`${ids}-project`}>
        <NativeSelect
          id={`${ids}-project`}
          value={projectId}
          onChange={(event) => changeProject(event.target.value)}
        >
          {options.map((p) => (
            <NativeOption key={p.id} value={p.id}>
              {p.name}
            </NativeOption>
          ))}
        </NativeSelect>
      </Field>

      <Field
        label="Workspace"
        htmlFor={`${ids}-workspace`}
        hint={workspace ? workspace.path : undefined}
      >
        <NativeSelect
          id={`${ids}-workspace`}
          value={workspace?.id ?? ''}
          disabled={!loaded}
          onChange={(event) => setWorkspaceId(event.target.value)}
        >
          {loaded ? (
            loaded.workspaces.map((w) => (
              <NativeOption key={w.id} value={w.id} disabled={w.status !== 'ready'}>
                {w.name}
                {w.branch ? ` (${w.branch})` : ''}
                {w.status === 'missing' ? ' · folder missing' : ''}
              </NativeOption>
            ))
          ) : (
            <NativeOption value="">Loading…</NativeOption>
          )}
        </NativeSelect>
      </Field>

      <Field
        label="Run"
        htmlFor={`${ids}-run`}
        hint={
          loaded && loaded.agents.length === 0
            ? 'No agents yet. Add one under Agents in the sidebar.'
            : undefined
        }
      >
        <NativeSelect
          id={`${ids}-run`}
          value={agent?.id ?? SHELL}
          disabled={!loaded}
          onChange={(event) => setRun(event.target.value)}
        >
          <NativeOption value={SHELL}>Plain shell</NativeOption>
          {loaded && loaded.agents.length > 0 && (
            <optgroup label="Agents" className="bg-popover text-muted-foreground">
              {loaded.agents.map((a) => (
                <NativeOption key={a.id} value={a.id}>
                  {agentLabel(a)}
                </NativeOption>
              ))}
            </optgroup>
          )}
        </NativeSelect>
      </Field>

      <Field label="Title" htmlFor={`${ids}-title`} hint="Optional. Shown on the panel's tab.">
        <Input
          id={`${ids}-title`}
          value={title}
          maxLength={100}
          placeholder={agent ? agent.name : 'Shell name'}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      <FormError message={choices && 'error' in choices ? choices.error : error} />

      <DialogFooter>
        <Button type="submit" disabled={!workspace || pending}>
          {pending ? <Loader2 className="animate-spin" /> : agent ? <Bot /> : <TerminalSquare />}
          {agent ? `Start ${agent.name}` : 'Open terminal'}
        </Button>
      </DialogFooter>
    </form>
  );
}
