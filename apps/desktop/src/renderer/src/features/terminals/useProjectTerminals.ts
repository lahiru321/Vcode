import type { Project, TerminalSession } from '@vcode/shared';
import { invoke } from '@renderer/lib/ipc';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

// The terminals shown for a project: the ones still running when the project is opened, plus
// those opened since (they stay, marked as ended, until closing comes in P2-07).

const INITIAL_SIZE = { cols: 80, rows: 24 }; // replaced by the real size once the view fits

export interface ProjectTerminals {
  terminals: TerminalSession[];
  activeId: string | null;
  loaded: boolean;
  activate: (id: string) => void;
  create: () => Promise<void>;
  markExited: (id: string, exitCode: number) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  const create = useCallback(async () => {
    try {
      const terminal = await invoke('terminals:create', { projectId: project.id, ...INITIAL_SIZE });
      setTerminals((current) => [...current, terminal]);
      setActiveId(terminal.id);
    } catch (error) {
      toast.error('Could not open a terminal', { description: errorMessage(error) });
    }
  }, [project.id]);

  const markExited = useCallback((id: string, exitCode: number) => {
    setTerminals((current) =>
      current.map((t) => (t.id === id ? { ...t, status: 'exited', exitCode } : t)),
    );
  }, []);

  return { terminals, activeId, loaded, activate: setActiveId, create, markExited };
}
