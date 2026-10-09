import type { Agent } from '@vcode/shared';
import { invoke } from '@renderer/lib/ipc';
import { errorMessage } from '@renderer/lib/form';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { useProjects } from '@renderer/features/projects/ProjectsProvider';
import { AgentDialog, type AgentSettings } from './AgentDialog';
import { DeleteAgentDialog } from './DeleteAgentDialog';

// The agents manager (P4-02, V1 doc §14): global agents plus the selected project's own, with
// add, edit, delete, CLI check and start.

/** Opens a terminal running the agent in the project on screen. */
export type AgentLauncher = (agent: Agent) => Promise<void>;

interface AgentsContextValue {
  agents: Agent[];
  loaded: boolean;
  loadError: string | null;
  reload: () => Promise<void>;
  startAdd: () => void;
  startEdit: (agent: Agent) => void;
  startDelete: (agent: Agent) => void;
  /** Runs the CLI's version check and shows the result. */
  validate: (agent: Agent) => Promise<void>;
  /** Starts the agent in the project on screen, if there is one that can run agents. */
  start: (agent: Agent) => Promise<void>;
  /** Whether `start` has somewhere to start agents. */
  canStart: boolean;
  /** The project view registers how to start an agent; returns a function that unregisters. */
  registerLauncher: (launcher: AgentLauncher) => () => void;
}

type DialogState =
  { kind: 'add' } | { kind: 'edit'; agent: Agent } | { kind: 'delete'; agent: Agent } | null;

const AgentsContext = createContext<AgentsContextValue | null>(null);

export function useAgents(): AgentsContextValue {
  const value = useContext(AgentsContext);
  if (!value) {
    throw new Error('useAgents must be used inside <AgentsProvider>');
  }
  return value;
}

export function AgentsProvider({ children }: { children: ReactNode }) {
  const { selected } = useProjects();
  const projectId = selected?.id;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const launcher = useRef<AgentLauncher | null>(null);
  const [canStart, setCanStart] = useState(false);

  const reload = useCallback(
    () =>
      invoke('agents:list', projectId ? { projectId } : {}).then(
        (list) => {
          setAgents(list);
          setLoadError(null);
          setLoaded(true);
        },
        (error: unknown) => {
          setLoadError(errorMessage(error));
          setLoaded(true);
        },
      ),
    [projectId],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Records whether the agent's CLI runs. A failed check never fails the save. */
  const check = useCallback(
    (id: string) => invoke('agents:validate', { id }).catch(() => undefined),
    [],
  );

  const save = useCallback(
    async (adapter: Agent['adapter'], settings: AgentSettings) => {
      if (dialog?.kind === 'edit') {
        const agent = await invoke('agents:update', { id: dialog.agent.id, ...settings });
        if (agent.status === 'unvalidated') {
          await check(agent.id);
        }
        toast.success(`Saved “${agent.name}”`);
      } else {
        const agent = await invoke('agents:create', { adapter, ...settings });
        await check(agent.id);
        toast.success(`Added “${agent.name}”`);
      }
      await reload();
      setDialog(null);
    },
    [dialog, check, reload],
  );

  const remove = useCallback(
    async (agent: Agent) => {
      await invoke('agents:delete', { id: agent.id });
      await reload();
      setDialog(null);
      toast.success(`Deleted “${agent.name}”`);
    },
    [reload],
  );

  const validate = useCallback(
    async (agent: Agent) => {
      try {
        const result = await invoke('agents:validate', { id: agent.id });
        if (result.agent.status === 'ready') {
          toast.success(`${agent.name}: CLI found`, {
            description: result.version ? `Version ${result.version}` : undefined,
          });
        } else {
          toast.warning(`${agent.name}: CLI not ready`, {
            description: result.message ?? undefined,
          });
        }
      } catch (error) {
        toast.error(`Could not check “${agent.name}”`, { description: errorMessage(error) });
      }
      await reload();
    },
    [reload],
  );

  const start = useCallback(
    async (agent: Agent) => {
      if (!launcher.current) {
        toast.error('Select an active project to start agents');
        return;
      }
      await launcher.current(agent);
      // Starting records a missing CLI as the agent's status.
      await reload();
    },
    [reload],
  );

  const registerLauncher = useCallback((next: AgentLauncher) => {
    launcher.current = next;
    setCanStart(true);
    return () => {
      if (launcher.current === next) {
        launcher.current = null;
        setCanStart(false);
      }
    };
  }, []);

  const value = useMemo<AgentsContextValue>(
    () => ({
      agents,
      loaded,
      loadError,
      reload,
      startAdd: () => setDialog({ kind: 'add' }),
      startEdit: (agent) => setDialog({ kind: 'edit', agent }),
      startDelete: (agent) => setDialog({ kind: 'delete', agent }),
      validate,
      start,
      canStart,
      registerLauncher,
    }),
    [agents, loaded, loadError, reload, validate, start, canStart, registerLauncher],
  );

  const close = () => setDialog(null);

  return (
    <AgentsContext.Provider value={value}>
      {children}
      <AgentDialog
        open={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        agent={dialog?.kind === 'edit' ? dialog.agent : null}
        project={selected?.status === 'active' ? selected : null}
        onSave={save}
        onClose={close}
      />
      <DeleteAgentDialog
        agent={dialog?.kind === 'delete' ? dialog.agent : null}
        onDelete={remove}
        onClose={close}
      />
    </AgentsContext.Provider>
  );
}
