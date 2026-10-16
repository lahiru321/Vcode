import type { AgentSessionStatus } from '@vcode/shared';
import { Notification, type BrowserWindow } from 'electron';
import { eq } from 'drizzle-orm';
import { agentSessionEvents, type AgentSessionUpdate } from './agents/sessions';
import { getDatabase } from './db';
import { agents, agentSessions, projects, terminalSessions, workspaces } from './db/schema';
import { APP_ICON_PATH } from './icon';
import { broadcastEvent } from './ipc';
import { createLogger } from './logging';
import { getSettings } from './settings/store';
import { showWindow } from './tray';

// Native notifications (P7-03, V1 doc §5): an agent finished, failed, or seems to be waiting for
// input, while the app isn't in front. Clicking one shows that agent's terminal. WAITING is a
// best-effort guess from terminal activity that can flip back quickly, so it is only announced
// once it has lasted a moment, and at most once a minute per agent run.

const log = createLogger('notifications');

/** WAITING must last this long before it's announced. */
const WAITING_SETTLE_MS = 2_000;
/** At most one "waiting" notification per agent run in this time. */
const WAITING_COOLDOWN_MS = 60_000;

interface RunInfo {
  agentName: string;
  projectId: string;
  projectName: string;
  terminalId: string | null;
  status: AgentSessionStatus;
}

/** The title and body for a status change, or null if it isn't worth a notification. */
export function notificationText(
  status: AgentSessionStatus,
  run: Pick<RunInfo, 'agentName' | 'projectName'>,
): { title: string; body: string } | null {
  switch (status) {
    case 'waiting':
      return { title: `${run.agentName} is waiting for input`, body: run.projectName };
    case 'completed':
      return { title: `${run.agentName} finished`, body: run.projectName };
    case 'failed':
      return { title: `${run.agentName} stopped with an error`, body: run.projectName };
    default:
      // Starting, working and ready are routine; `stopped` was the user's own doing.
      return null;
  }
}

function runInfo(agentSessionId: string): RunInfo | undefined {
  const db = getDatabase();
  const row = db
    .select({
      agentName: agents.name,
      projectId: projects.id,
      projectName: projects.name,
      status: agentSessions.status,
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .innerJoin(workspaces, eq(agentSessions.workspaceId, workspaces.id))
    .innerJoin(projects, eq(workspaces.projectId, projects.id))
    .where(eq(agentSessions.id, agentSessionId))
    .get();
  if (!row) return undefined;
  const terminal = db
    .select({ id: terminalSessions.id })
    .from(terminalSessions)
    .where(eq(terminalSessions.agentSessionId, agentSessionId))
    .get();
  return { ...row, terminalId: terminal?.id ?? null };
}

/** Starts announcing agent status changes; returns a function that stops it. */
export function startNotifications(getWindow: () => BrowserWindow | null): () => void {
  const pendingWaits = new Map<string, ReturnType<typeof setTimeout>>();
  const lastWaiting = new Map<string, number>();
  // Kept until closed: a garbage-collected notification loses its click handler.
  const shown = new Set<Notification>();

  const inFront = () => {
    const window = getWindow();
    return window !== null && window.isVisible() && window.isFocused();
  };

  const show = (agentSessionId: string, status: AgentSessionStatus) => {
    if (!Notification.isSupported() || inFront()) return;
    try {
      if (!getSettings(getDatabase()).notifications) return;
      const run = runInfo(agentSessionId);
      const text = run && notificationText(status, run);
      if (!run || !text) return;
      const notification = new Notification({ ...text, icon: APP_ICON_PATH });
      shown.add(notification);
      notification.on('close', () => shown.delete(notification));
      notification.on('click', () => {
        shown.delete(notification);
        const window = getWindow();
        if (!window) return;
        showWindow(window);
        if (run.terminalId) {
          broadcastEvent('app:command', {
            command: 'showTerminal',
            projectId: run.projectId,
            terminalId: run.terminalId,
          });
        }
      });
      notification.show();
    } catch (err) {
      log.warn({ err, agentSessionId, status }, 'could not show a notification');
    }
  };

  const onStatus = ({ agentSessionId, status }: AgentSessionUpdate) => {
    clearTimeout(pendingWaits.get(agentSessionId));
    pendingWaits.delete(agentSessionId);
    if (status !== 'waiting') {
      if (status !== 'ready' && status !== 'working') lastWaiting.delete(agentSessionId);
      show(agentSessionId, status);
      return;
    }
    const last = lastWaiting.get(agentSessionId);
    if (last !== undefined && Date.now() - last < WAITING_COOLDOWN_MS) return;
    pendingWaits.set(
      agentSessionId,
      setTimeout(() => {
        pendingWaits.delete(agentSessionId);
        // Still waiting? It may have gone back to work, or ended, meanwhile.
        if (runInfo(agentSessionId)?.status !== 'waiting') return;
        lastWaiting.set(agentSessionId, Date.now());
        show(agentSessionId, 'waiting');
      }, WAITING_SETTLE_MS),
    );
  };

  agentSessionEvents.on('status', onStatus);
  return () => {
    agentSessionEvents.off('status', onStatus);
    for (const timer of pendingWaits.values()) clearTimeout(timer);
  };
}
