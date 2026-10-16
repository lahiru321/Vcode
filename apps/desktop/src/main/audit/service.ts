import type { AuditAction, AuditEntry, ListAuditRequest } from '@vcode/shared';
import { and, desc, eq, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { agentSessionEvents, getAgentSession } from '../agents/sessions';
import type { AppDatabase } from '../db';
import { agents, auditLogs, projects, workspaces } from '../db/schema';
import { createLogger } from '../logging';
import { redactSecrets } from '../logging/redact';

// Audit log (P7-05, V1 doc §21): terminal starts and stops, agent runs and changes, API key
// changes and workspace operations, kept in `audit_logs`. Recording never fails the action it
// records. Values are plain facts (names, statuses, paths), never secrets; text is passed
// through the same secret redaction as the log files anyway.

const log = createLogger('audit');

export type AuditValue = string | number | boolean | null;

export interface AuditRecord {
  projectId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, AuditValue | undefined>;
}

/** The newest this many entries are kept (trimmed at startup). */
export const AUDIT_KEEP = 10_000;
const DEFAULT_PAGE = 100;
/** Insertion order, for entries from the same millisecond. */
const ROWID = sql<number>`"audit_logs"."rowid"`;

function clean(metadata: AuditRecord['metadata']): Record<string, AuditValue> {
  const result: Record<string, AuditValue> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (value !== undefined) {
      result[key] = typeof value === 'string' ? redactSecrets(value) : value;
    }
  }
  return result;
}

export function recordAudit(db: AppDatabase, record: AuditRecord): void {
  try {
    db.insert(auditLogs)
      .values({
        projectId: record.projectId ?? null,
        action: record.action,
        resourceType: record.resourceType,
        resourceId: record.resourceId ?? null,
        metadataJson: clean(record.metadata),
      })
      .run();
  } catch (err) {
    log.warn({ err, action: record.action }, 'could not record an audit entry');
  }
}

/** Newest first; `after` (the last entry of a page) continues it. */
export function listAudit(
  db: AppDatabase,
  request: ListAuditRequest = {},
): { entries: AuditEntry[]; hasMore: boolean } {
  const limit = request.limit ?? DEFAULT_PAGE;
  const conditions: SQL[] = [];
  if (request.projectId) conditions.push(eq(auditLogs.projectId, request.projectId));
  if (request.after) {
    // Entries can share a millisecond: order by time, then by insertion (rowid).
    const cursor = db
      .select({ createdAt: auditLogs.createdAt, rowid: ROWID })
      .from(auditLogs)
      .where(eq(auditLogs.id, request.after))
      .get();
    if (cursor) {
      conditions.push(
        or(
          lt(auditLogs.createdAt, cursor.createdAt),
          and(eq(auditLogs.createdAt, cursor.createdAt), lt(ROWID, cursor.rowid)),
        )!,
      );
    }
  }
  const rows = db
    .select({
      id: auditLogs.id,
      projectId: auditLogs.projectId,
      projectName: projects.name,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      metadata: auditLogs.metadataJson,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(projects, eq(auditLogs.projectId, projects.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt), desc(ROWID))
    .limit(limit + 1)
    .all();
  return {
    entries: rows.slice(0, limit).map((row) => ({
      ...row,
      projectName: row.projectName ?? null,
      action: row.action as AuditAction,
      metadata: (row.metadata ?? {}) as Record<string, AuditValue>,
    })),
    hasMore: rows.length > limit,
  };
}

/** Deletes all but the newest `keep` entries. */
export function pruneAudit(db: AppDatabase, keep = AUDIT_KEEP): number {
  const newest = db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt), desc(ROWID))
    .limit(keep);
  return db.delete(auditLogs).where(notInArray(auditLogs.id, newest)).run().changes;
}

/** A workspace's project and name, for entries about things that happen in it. */
export function workspaceContext(
  db: AppDatabase,
  workspaceId: string,
): { projectId: string | null; workspace: string | null } {
  const row = db
    .select({ projectId: workspaces.projectId, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();
  return { projectId: row?.projectId ?? null, workspace: row?.name ?? null };
}

const ENDINGS = ['completed', 'failed', 'stopped'] as const;

/** Records every agent run that ends (finished, failed, or stopped); returns how to stop. */
export function trackAgentRunEnds(db: AppDatabase): () => void {
  const onStatus = ({ agentSessionId, status }: { agentSessionId: string; status: string }) => {
    if (!(ENDINGS as readonly string[]).includes(status)) return;
    const run = getAgentSession(db, agentSessionId);
    if (!run) return;
    const agent = db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, run.agentId))
      .get();
    const { projectId, workspace } = workspaceContext(db, run.workspaceId);
    recordAudit(db, {
      projectId,
      action: 'agent.end',
      resourceType: 'agent_session',
      resourceId: agentSessionId,
      metadata: { agent: agent?.name ?? null, workspace, status, exitCode: run.exitCode },
    });
  };
  agentSessionEvents.on('status', onStatus);
  return () => agentSessionEvents.off('status', onStatus);
}
