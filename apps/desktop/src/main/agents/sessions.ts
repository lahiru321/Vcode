import { EventEmitter } from 'node:events';
import { getAdapter, type AgentActivity, type TerminalSignal } from '@vcode/adapters';
import {
  ACTIVE_AGENT_SESSION_STATUSES,
  type AgentAdapter as AdapterId,
  type AgentSessionStatus,
  type SessionStatus,
} from '@vcode/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { agents, agentSessions } from '../db/schema';
import { createLogger } from '../logging';

// Agent sessions (V1 doc §13, §18 "agent_sessions"): one run of an agent, always in a terminal
// (terminal_sessions.agent_session_id). The terminal records the process; the agent session
// records the agent's lifecycle: CREATED → STARTING → READY → WORKING ⇄ WAITING → STOPPED /
// FAILED / COMPLETED.

export type AgentSessionRow = typeof agentSessions.$inferSelect;

export interface AgentSessionUpdate {
  agentSessionId: string;
  agentId: string;
  status: AgentSessionStatus;
}

/** `status` after every change; the IPC layer forwards it as `agent:status`. */
export const agentSessionEvents = new EventEmitter<{ status: [update: AgentSessionUpdate] }>();

const log = createLogger('agents');
const ACTIVE = [...ACTIVE_AGENT_SESSION_STATUSES];

export function createAgentSession(
  db: Pick<AppDatabase, 'insert'>,
  agentId: string,
  workspaceId: string,
): AgentSessionRow {
  return db
    .insert(agentSessions)
    .values({ agentId, workspaceId, status: 'created' })
    .returning()
    .get();
}

/**
 * Moves an agent session to `status`, if it is still active (an ended session never comes
 * back). Ending statuses also record the end time and exit code. Returns whether it changed.
 */
export function setAgentSessionStatus(
  db: AppDatabase,
  id: string,
  status: AgentSessionStatus,
  exitCode: number | null = null,
): boolean {
  const ending = !(ACTIVE as AgentSessionStatus[]).includes(status);
  const row = db
    .update(agentSessions)
    .set(ending ? { status, exitCode, endedAt: Date.now() } : { status })
    .where(and(eq(agentSessions.id, id), inArray(agentSessions.status, ACTIVE)))
    .returning()
    .get();
  if (!row) {
    return false;
  }
  agentSessionEvents.emit('status', { agentSessionId: id, agentId: row.agentId, status });
  if (ending) {
    cleanup(db, row);
  }
  return true;
}

/**
 * READY / WORKING / WAITING, best-effort (V1 doc §13): the agent's adapter reads a terminal
 * signal from the PTY host (./pty-host/activity) given the current status. Returns the new
 * status, or null if nothing changed.
 */
export function applyTerminalSignal(
  db: AppDatabase,
  agentSessionId: string,
  signal: TerminalSignal,
): AgentSessionStatus | null {
  const row = db
    .select({ status: agentSessions.status, adapter: agents.adapter })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(eq(agentSessions.id, agentSessionId))
    .get();
  const adapter = row ? getAdapter(row.adapter) : null;
  if (!row || !adapter) {
    return null;
  }
  let current: AgentActivity | 'starting';
  switch (row.status) {
    case 'created':
    case 'starting':
      current = 'starting';
      break;
    case 'ready':
    case 'working':
    case 'waiting':
      current = row.status;
      break;
    default:
      return null; // ended
  }
  const next = adapter.getStatus(current, signal);
  if (!next || next === current) {
    return null;
  }
  return setAgentSessionStatus(db, agentSessionId, next) ? next : null;
}

/** An agent session's end, from how its terminal ended. */
export function agentEndStatus(
  terminalStatus: Exclude<SessionStatus, 'starting' | 'running'>,
  exitCode: number | null,
): AgentSessionStatus {
  if (terminalStatus === 'exited') {
    return exitCode === 0 ? 'completed' : 'failed';
  }
  return terminalStatus;
}

/** Lets the adapter tidy up after a session, however it ended. Errors are only logged. */
function cleanup(db: AppDatabase, session: AgentSessionRow): void {
  const agent = db
    .select({ adapter: agents.adapter })
    .from(agents)
    .where(eq(agents.id, session.agentId))
    .get();
  const adapter = agent ? getAdapter(agent.adapter) : null;
  adapter?.cleanup({ sessionId: session.id }).catch((err: unknown) => {
    log.warn({ err, agentSessionId: session.id }, 'agent cleanup failed');
  });
}

/** Marks agent sessions an earlier run left active as `failed`. Call at launch. */
export function failStaleAgentSessions(db: AppDatabase): number {
  return db
    .update(agentSessions)
    .set({ status: 'failed', endedAt: Date.now() })
    .where(inArray(agentSessions.status, ACTIVE))
    .returning({ id: agentSessions.id })
    .all().length;
}

export interface AgentSessionSummary {
  sessionId: string;
  agentId: string;
  name: string;
  adapter: AdapterId;
  status: AgentSessionStatus;
}

/** Agent name and session status for the given agent sessions, for terminal tabs. */
export function summarizeAgentSessions(
  db: AppDatabase,
  ids: string[],
): Map<string, AgentSessionSummary> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = db
    .select({
      sessionId: agentSessions.id,
      agentId: agentSessions.agentId,
      name: agents.name,
      adapter: agents.adapter,
      status: agentSessions.status,
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(inArray(agentSessions.id, ids))
    .all();
  return new Map(rows.map((row) => [row.sessionId, row]));
}

export function getAgentSession(db: AppDatabase, id: string): AgentSessionRow | undefined {
  return db.select().from(agentSessions).where(eq(agentSessions.id, id)).get();
}
