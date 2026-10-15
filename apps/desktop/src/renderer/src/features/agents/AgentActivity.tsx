import {
  ACTIVE_AGENT_SESSION_STATUSES,
  type ActiveAgentSession,
  type AgentSessionStatus,
} from '@vcode/shared';
import { invoke, onEvent } from '@renderer/lib/ipc';
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';

// Agent runs still going, in every project (P5-07): for the sidebar's agent and project rows
// and the status bar. Loaded once, then kept current from `agent:status`.

const ACTIVE: readonly AgentSessionStatus[] = ACTIVE_AGENT_SESSION_STATUSES;

/** The status that matters most to the user, for a summary dot: waiting for you comes first. */
const PRIORITY: AgentSessionStatus[] = ['waiting', 'working', 'ready', 'starting', 'created'];

export function topStatus(sessions: ActiveAgentSession[]): AgentSessionStatus | null {
  return PRIORITY.find((status) => sessions.some((s) => s.status === status)) ?? null;
}

const AgentActivityContext = createContext<ActiveAgentSession[]>([]);

/** Every agent run still going. */
export function useAgentActivity(): ActiveAgentSession[] {
  return use(AgentActivityContext);
}

export function AgentActivityProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<ActiveAgentSession[]>([]);
  // Bumped to load the list again: a new run's first event doesn't say which project it is in.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    invoke('agents:sessions').then(
      (list) => !cancelled && setSessions(list),
      (error: unknown) => console.warn('Could not load running agents:', error),
    );
    return () => {
      cancelled = true;
    };
  }, [generation]);

  const latest = useRef(sessions);
  useEffect(() => {
    latest.current = sessions;
  });

  useEffect(
    () =>
      onEvent('agent:status', ({ agentSessionId, status }) => {
        const known = latest.current.some((s) => s.sessionId === agentSessionId);
        if (!ACTIVE.includes(status)) {
          if (known) {
            setSessions((current) => current.filter((s) => s.sessionId !== agentSessionId));
          }
        } else if (known) {
          setSessions((current) =>
            current.map((s) => (s.sessionId === agentSessionId ? { ...s, status } : s)),
          );
        } else {
          setGeneration((n) => n + 1);
        }
      }),
    [],
  );

  return <AgentActivityContext value={sessions}>{children}</AgentActivityContext>;
}
