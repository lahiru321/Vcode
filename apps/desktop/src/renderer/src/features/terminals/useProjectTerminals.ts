import type { Agent, Project, TerminalSession } from '@vcode/shared';
import { invoke, onEvent } from '@renderer/lib/ipc';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

// The terminals shown for a project: the ones still running when the project is opened, plus
// those opened since. Ended terminals stay (marked as ended) until they are closed.

const INITIAL_SIZE = { cols: 80, rows: 24 }; // replaced by the real size once the view fits

export interface ProjectTerminals {
  terminals: TerminalSession[];
  activeId: string | null;
  loaded: boolean;
  activate: (id: string) => void;
  create: () => Promise<void>;
  /** Opens a terminal running Claude Code (P3-07). */
  startClaude: () => Promise<void>;
  /** Ends the terminal's process tree; the tab stays, marked as stopped. */
  stop: (id: string) => Promise<void>;
  /** Replaces the terminal's tab with a new terminal in the same place. */
  restart: (id: string) => Promise<void>;
  /** Stops the terminal if it is running and removes its tab. */
  close: (id: string) => Promise<void>;
  markExited: (id: string, exitCode: number) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The agent the "Start Claude Code" button runs: the project's own Claude agent, else a global
 * one, else a new global "Claude Code" agent with the defaults (the agents manager is P4).
 */
async function claudeAgent(projectId: string): Promise<Agent> {
  const agents = (await invoke('agents:list', { projectId })).filter((a) => a.adapter === 'claude');
  const found = agents.find((a) => a.projectId === projectId) ?? agents[0];
  return found ?? invoke('agents:create', { name: 'Claude Code', adapter: 'claude' });
}

/** Use with `key={project.id}`, so switching projects starts from a fresh state. */
export function useProjectTerminals(project: Project): ProjectTerminals {
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke('terminals:list', { projectId: project.id }).then(
      (list) => {
        if (cancelled) return;
        const running = list.filter((t) => t.status === 'running');
        setTerminals(running);
        setActiveId(running.at(-1)?.id ?? null);
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

  // Agent status changes (starting → ready → working ⇄ waiting → …) for this project's tabs.
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
    setActiveId(terminal.id);
  }, []);

  const create = useCallback(async () => {
    try {
      open(await invoke('terminals:create', { projectId: project.id, ...INITIAL_SIZE }));
    } catch (error) {
      toast.error('Could not open a terminal', { description: errorMessage(error) });
    }
  }, [project.id, open]);

  const startClaude = useCallback(async () => {
    try {
      const agent = await claudeAgent(project.id);
      open(
        await invoke('terminals:create', {
          projectId: project.id,
          agentId: agent.id,
          ...INITIAL_SIZE,
        }),
      );
    } catch (error) {
      toast.error('Could not start Claude Code', { description: errorMessage(error) });
    }
  }, [project.id, open]);

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
        const terminal = await invoke('terminals:restart', { terminalId: id });
        replace(id, terminal);
        setActiveId((current) => (current === id ? terminal.id : current));
      } catch (error) {
        toast.error('Could not restart the terminal', { description: errorMessage(error) });
      }
    },
    [replace],
  );

  const close = useCallback(
    async (id: string) => {
      try {
        await invoke('terminals:close', { terminalId: id });
      } catch (error) {
        toast.error('Could not close the terminal', { description: errorMessage(error) });
        return;
      }
      const index = terminals.findIndex((t) => t.id === id);
      const remaining = terminals.filter((t) => t.id !== id);
      setTerminals(remaining);
      // Like browser tabs: the neighbour on the right, else the one on the left.
      setActiveId((current) =>
        current === id ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null) : current,
      );
    },
    [terminals],
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
    activeId,
    loaded,
    activate: setActiveId,
    create,
    startClaude,
    stop,
    restart,
    close,
    markExited,
  };
}
