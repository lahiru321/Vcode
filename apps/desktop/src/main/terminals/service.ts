import { basename, extname } from 'node:path';
import { IpcError, type CreateTerminalRequest, type SessionStatus } from '@vcode/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { terminalSessions, workspaces } from '../db/schema';
import { resolveExistingFolder } from '../fs/folders';
import type { Command, Environment } from '../platform';
import { getProject } from '../projects/service';
import { PtyHostError, type PtyHostSupervisor, type TerminalExit } from '../pty-host/supervisor';
import { ensureMainWorkspace, getWorkspace } from '../workspaces/service';

// Terminal sessions (V1 doc §11, §18 "terminal_sessions"). Main decides what to run and where,
// records the session, and asks the PTY host to start it; the host reports when it ends.

export type TerminalRow = typeof terminalSessions.$inferSelect;

export interface TerminalDeps {
  db: AppDatabase;
  host: Pick<PtyHostSupervisor, 'request'>;
  /** The environment for new terminals. */
  environment: () => Promise<Environment>;
  /** The shell to run and how to start it. */
  resolveShell: (env: Environment) => Promise<{ shell: string; command: Command }>;
}

const ACTIVE: SessionStatus[] = ['starting', 'running'];

/** Sessions started by this run of the app; rows left over from a crash are P2-09's job. */
const activeSessions = new Set<string>();

/** "C:\…\pwsh.exe" → "pwsh", "/bin/zsh" → "zsh". */
function shellTitle(shell: string): string {
  return basename(shell, extname(shell));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createTerminal(
  deps: TerminalDeps,
  request: CreateTerminalRequest,
): Promise<TerminalRow> {
  const { db } = deps;
  const project = getProject(db, request.projectId);
  if (project.status === 'archived') {
    throw new IpcError('CONFLICT', 'Restore the project to open terminals in it.');
  }
  const workspace = request.workspaceId
    ? getWorkspace(db, request.workspaceId, project.id)
    : ensureMainWorkspace(db, project);
  // Checked now rather than left to the spawn, which fails with a less helpful message.
  const cwd = await resolveExistingFolder(workspace.path);

  const env = await deps.environment();
  const { shell, command } = await deps.resolveShell(env);

  const row = db
    .insert(terminalSessions)
    .values({
      workspaceId: workspace.id,
      title: request.title ?? shellTitle(shell),
      shell,
      cwd,
      cols: request.cols,
      rows: request.rows,
      status: 'starting',
    })
    .returning()
    .get();

  try {
    const { pid } = await deps.host.request('spawn', {
      sessionId: row.id,
      file: command.file,
      args: command.verbatimArguments ? command.args.join(' ') : command.args,
      cwd,
      env,
      cols: request.cols,
      rows: request.rows,
    });
    activeSessions.add(row.id);
    // Only if no exit arrived in between.
    return (
      db
        .update(terminalSessions)
        .set({ pid, status: 'running' })
        .where(and(eq(terminalSessions.id, row.id), eq(terminalSessions.status, 'starting')))
        .returning()
        .get() ?? getTerminal(db, row.id)
    );
  } catch (error) {
    db.update(terminalSessions)
      .set({ status: 'failed', endedAt: Date.now() })
      .where(eq(terminalSessions.id, row.id))
      .run();
    const unavailable = error instanceof PtyHostError && error.reason === 'unavailable';
    throw new IpcError(
      unavailable ? 'UNAVAILABLE' : 'INTERNAL',
      `Could not start the terminal: ${errorMessage(error)}`,
    );
  }
}

/**
 * Connects `hostPort` (one end of a MessageChannel) to a running terminal in the PTY host; the
 * caller gives the other end to the renderer. CONFLICT if the terminal has ended.
 */
export async function attachTerminal(
  deps: Pick<TerminalDeps, 'db' | 'host'>,
  terminalId: string,
  hostPort: unknown,
): Promise<void> {
  const terminal = getTerminal(deps.db, terminalId);
  if (terminal.status !== 'running') {
    throw new IpcError('CONFLICT', 'This terminal is no longer running.');
  }
  try {
    await deps.host.request('attach', { sessionId: terminalId }, { transfer: [hostPort] });
  } catch (error) {
    const unavailable = error instanceof PtyHostError && error.reason === 'unavailable';
    throw new IpcError(
      unavailable ? 'UNAVAILABLE' : 'INTERNAL',
      `Could not connect to the terminal: ${errorMessage(error)}`,
    );
  }
}

export function getTerminal(db: AppDatabase, id: string): TerminalRow {
  const row = db.select().from(terminalSessions).where(eq(terminalSessions.id, id)).get();
  if (!row) {
    throw new IpcError('NOT_FOUND', 'Terminal not found.');
  }
  return row;
}

/** The project's terminals, oldest first. */
export function listTerminals(db: AppDatabase, projectId: string): TerminalRow[] {
  getProject(db, projectId);
  return db
    .select({ terminal: terminalSessions })
    .from(terminalSessions)
    .innerJoin(workspaces, eq(terminalSessions.workspaceId, workspaces.id))
    .where(eq(workspaces.projectId, projectId))
    .orderBy(terminalSessions.startedAt)
    .all()
    .map((row) => row.terminal);
}

/**
 * Records a terminal whose process ended: `exited` on its own, `stopped` when the app closed it
 * (e.g. the PTY host closing every terminal on quit).
 */
export function recordTerminalExit(
  db: AppDatabase,
  exit: TerminalExit,
  status: 'exited' | 'stopped' = 'exited',
): void {
  activeSessions.delete(exit.sessionId);
  db.update(terminalSessions)
    .set({ status, exitCode: exit.exitCode, endedAt: Date.now() })
    .where(and(eq(terminalSessions.id, exit.sessionId), inArray(terminalSessions.status, ACTIVE)))
    .run();
}

/**
 * Ends every session of this run when the PTY host goes away: `stopped` when the app shut it
 * down, `failed` when it crashed (V1 doc §11 "Crash safety"). Returns their process IDs: a
 * shell can outlive the host that started it, so the caller kills these trees.
 */
export function endActiveSessions(db: AppDatabase, status: 'stopped' | 'failed'): number[] {
  if (activeSessions.size === 0) {
    return [];
  }
  const ended = db
    .update(terminalSessions)
    .set({ status, endedAt: Date.now() })
    .where(
      and(
        inArray(terminalSessions.id, [...activeSessions]),
        inArray(terminalSessions.status, ACTIVE),
      ),
    )
    .returning({ pid: terminalSessions.pid })
    .all();
  activeSessions.clear();
  return ended.flatMap(({ pid }) => (pid === null ? [] : [pid]));
}

/**
 * Marks sessions left `starting`/`running` by an earlier run (a crash, or a dev restart) as
 * `failed`: their PTY host is gone, so they can't be attached. Call at launch, before any
 * terminal starts. Killing their leftover processes is P2-09. Returns how many were marked.
 */
export function failStaleSessions(db: AppDatabase): number {
  return db
    .update(terminalSessions)
    .set({ status: 'failed', endedAt: Date.now() })
    .where(inArray(terminalSessions.status, ACTIVE))
    .returning({ id: terminalSessions.id })
    .all().length;
}
