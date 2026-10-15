import type { Agent, JsonValue, Project, TerminalSession } from '@vcode/shared';
import { invoke, onEvent } from '@renderer/lib/ipc';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

// The terminals shown for a project: the ones still running when the project is opened, plus
// those opened since. Ended terminals stay (marked as ended) until they are closed. Where each one
// is shown, and which is active, is up to the panel grid (TerminalGrid), whose layout is saved
// per project (P5-05). Ended terminals that the saved layout still shows come back too, as
// "restored": their panels keep their place and offer a restart (e.g. after the app was closed).

/** Size a terminal is created at; replaced by the real size once its view fits. */
export const INITIAL_SIZE = { cols: 80, rows: 24 };

export interface ProjectTerminals {
  terminals: TerminalSession[];
  loaded: boolean;
  /** The grid as it was saved for the project, or null. Read once, when the grid starts. */
  savedLayout: JsonValue | null;
  /** Ended terminals that came back with the saved layout: they have no screen to show. */
  restoredIds: ReadonlySet<string>;
  /** Saves the grid for the next time the project opens. */
  saveLayout: (layout: JsonValue | null) => void;
  /** Opens a plain shell; resolves to the new terminal, or null if it could not be opened. */
  create: () => Promise<TerminalSession | null>;
  /** Shows a terminal of this project that was opened elsewhere (the New terminal dialog). */
  adopt: (terminal: TerminalSession) => void;
  /** Opens a terminal running Claude Code (P3-07). */
  startClaude: () => Promise<void>;
  /** Opens a terminal running `agent` (global, or one of this project's). */
  startAgent: (agent: Agent) => Promise<void>;
  /** Ends the terminal's process tree; its panel stays, marked as stopped. */
  stop: (id: string) => Promise<void>;
  /** Replaces the terminal with a new one at the same place in the list. */
  restart: (id: string) => Promise<void>;
  /** Changes the title on the terminal's tab; resolves to whether it worked. */
  rename: (id: string, title: string) => Promise<boolean>;
  /** Stops the terminal if it is running and removes it. */
  close: (id: string) => Promise<void>;
  markExited: (id: string, exitCode: number) => void;
}

/** The terminal ids in a saved dockview layout (its panel ids). */
function layoutPanelIds(layout: JsonValue | null): Set<string> {
  const panels =
    layout && typeof layout === 'object' && !Array.isArray(layout) ? layout.panels : null;
  return new Set(
    panels && typeof panels === 'object' && !Array.isArray(panels) ? Object.keys(panels) : [],
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The agent the "Start Claude Code" button runs: the project's own Claude agent, else a global
 * one, else a new global "Claude Code" agent with the defaults.
 */
async function claudeAgent(projectId: string): Promise<Agent> {
  const agents = (await invoke('agents:list', { projectId })).filter((a) => a.adapter === 'claude');
  const found = agents.find((a) => a.projectId === projectId) ?? agents[0];
  return found ?? invoke('agents:create', { name: 'Claude Code', adapter: 'claude' });
}

/** Use with `key={project.id}`, so switching projects starts from a fresh state. */
export function useProjectTerminals(project: Project): ProjectTerminals {
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [savedLayout, setSavedLayout] = useState<JsonValue | null>(null);
  const [restoredIds, setRestoredIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    // Without its layout the project still opens, with the running terminals in a fresh grid.
    const layout = invoke('projects:getLayout', { id: project.id }).then(
      (saved) => saved.layout,
      (error: unknown) => {
        console.warn('Could not load the saved layout:', errorMessage(error));
        return null;
      },
    );
    Promise.all([invoke('terminals:list', { projectId: project.id }), layout]).then(
      ([list, layout]) => {
        if (cancelled) return;
        const inLayout = layoutPanelIds(layout);
        const ended = list.filter((t) => t.status !== 'running' && inLayout.has(t.id));
        setTerminals(list.filter((t) => t.status === 'running' || inLayout.has(t.id)));
        setRestoredIds(new Set(ended.map((t) => t.id)));
        setSavedLayout(layout);
        setLoaded(true);
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoaded(true);
        toast.error('Could not load terminals', { description: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Agent status changes (starting → ready → working ⇄ waiting → …) for this project's terminals.
  useEffect(
    () =>
      onEvent('agent:status', ({ agentSessionId, status }) => {
        setTerminals((current) =>
          current.some((t) => t.agent?.sessionId === agentSessionId)
            ? current.map((t) =>
                t.agent?.sessionId === agentSessionId ? { ...t, agent: { ...t.agent, status } } : t,
              )
            : current,
        );
      }),
    [],
  );

  const replace = useCallback((id: string, terminal: TerminalSession) => {
    setTerminals((current) => current.map((t) => (t.id === id ? terminal : t)));
  }, []);

  const open = useCallback((terminal: TerminalSession) => {
    setTerminals((current) => [...current, terminal]);
    return terminal;
  }, []);

  const create = useCallback(async () => {
    try {
      return open(await invoke('terminals:create', { projectId: project.id, ...INITIAL_SIZE }));
    } catch (error) {
      toast.error('Could not open a terminal', { description: errorMessage(error) });
      return null;
    }
  }, [project.id, open]);

  const launch = useCallback(
    async (agent: Agent) =>
      open(
        await invoke('terminals:create', {
          projectId: project.id,
          agentId: agent.id,
          ...INITIAL_SIZE,
        }),
      ),
    [project.id, open],
  );

  const startClaude = useCallback(async () => {
    try {
      await launch(await claudeAgent(project.id));
    } catch (error) {
      toast.error('Could not start Claude Code', { description: errorMessage(error) });
    }
  }, [project.id, launch]);

  const startAgent = useCallback(
    async (agent: Agent) => {
      try {
        await launch(agent);
      } catch (error) {
        toast.error(`Could not start “${agent.name}”`, { description: errorMessage(error) });
      }
    },
    [launch],
  );

  const stop = useCallback(
    async (id: string) => {
      try {
        replace(id, await invoke('terminals:stop', { terminalId: id }));
      } catch (error) {
        toast.error('Could not stop the terminal', { description: errorMessage(error) });
      }
    },
    [replace],
  );

  const restart = useCallback(
    async (id: string) => {
      try {
        replace(id, await invoke('terminals:restart', { terminalId: id }));
      } catch (error) {
        toast.error('Could not restart the terminal', { description: errorMessage(error) });
      }
    },
    [replace],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      try {
        replace(id, await invoke('terminals:rename', { terminalId: id, title }));
        return true;
      } catch (error) {
        toast.error('Could not rename the terminal', { description: errorMessage(error) });
        return false;
      }
    },
    [replace],
  );

  const close = useCallback(async (id: string) => {
    try {
      await invoke('terminals:close', { terminalId: id });
    } catch (error) {
      toast.error('Could not close the terminal', { description: errorMessage(error) });
      return;
    }
    setTerminals((current) => current.filter((t) => t.id !== id));
  }, []);

  const saveLayout = useCallback(
    (layout: JsonValue | null) => {
      invoke('projects:saveLayout', { id: project.id, layout }).catch((error: unknown) => {
        console.warn('Could not save the layout:', errorMessage(error));
      });
    },
    [project.id],
  );

  const markExited = useCallback((id: string, exitCode: number) => {
    // A stopped terminal keeps its status; its process exiting is expected.
    setTerminals((current) =>
      current.map((t) =>
        t.id === id && t.status === 'running' ? { ...t, status: 'exited', exitCode } : t,
      ),
    );
  }, []);

  return {
    terminals,
    loaded,
    savedLayout,
    restoredIds,
    saveLayout,
    create,
    adopt: open,
    startClaude,
    startAgent,
    stop,
    restart,
    rename,
    close,
    markExited,
  };
}
