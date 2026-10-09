import {
  getAdapter,
  type AdapterContext,
  type AgentAdapter,
  type AgentConfig,
} from '@vcode/adapters';
import { IpcError, type Agent, type AgentValidation, type CreateAgentRequest } from '@vcode/shared';
import { eq, isNull, or, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { agents } from '../db/schema';
import type { Environment } from '../platform';
import { getProject } from '../projects/service';

// Agents (V1 doc §12, §14, §18 "agents"): a configured CLI that terminals can run. The adapter
// for its provider decides how to check and start it.

export type AgentRow = typeof agents.$inferSelect;

export interface AgentDeps {
  db: AppDatabase;
  adapters: AdapterContext;
  /** The environment agents run with, before the adapter adds its own variables. */
  environment: () => Promise<Environment>;
}

export function toAgent(row: AgentRow): Agent {
  // credentialId comes with credentials (P4); the response schema would strip it anyway.
  const { argsJson, envJson, ...rest } = row;
  return { ...rest, args: argsJson, env: envJson };
}

export function agentConfig(row: AgentRow): AgentConfig {
  return {
    name: row.name,
    executable: row.executable,
    args: row.argsJson,
    env: row.envJson,
    model: row.model,
    role: row.role,
    instructions: row.instructions,
  };
}

/** The agent's adapter. INVALID_REQUEST for providers that have none yet (P4). */
export function adapterFor(adapter: string): AgentAdapter {
  const found = getAdapter(adapter);
  if (!found) {
    throw new IpcError('INVALID_REQUEST', `"${adapter}" agents aren't supported yet.`);
  }
  return found;
}

/** Global agents and, with `projectId`, that project's own; by name. */
export function listAgents(db: AppDatabase, projectId?: string): AgentRow[] {
  if (projectId) {
    getProject(db, projectId);
  }
  return db
    .select()
    .from(agents)
    .where(
      projectId
        ? or(isNull(agents.projectId), eq(agents.projectId, projectId))
        : isNull(agents.projectId),
    )
    .orderBy(sql`${agents.name} collate nocase`, agents.createdAt)
    .all();
}

export function getAgent(db: AppDatabase, id: string): AgentRow {
  const row = db.select().from(agents).where(eq(agents.id, id)).get();
  if (!row) {
    throw new IpcError('NOT_FOUND', 'Agent not found. It may have been deleted.');
  }
  return row;
}

const blankToNull = (value: string | null | undefined): string | null => value?.trim() || null;

export function createAgent(db: AppDatabase, request: CreateAgentRequest): AgentRow {
  const adapter = adapterFor(request.adapter);
  const projectId = request.projectId ?? null;
  if (projectId) {
    getProject(db, projectId);
  }
  return db
    .insert(agents)
    .values({
      projectId,
      name: request.name,
      adapter: request.adapter,
      executable: request.executable?.trim() || adapter.defaultExecutable,
      argsJson: request.args ?? [],
      envJson: request.env ?? {},
      model: blankToNull(request.model),
      role: blankToNull(request.role),
      instructions: blankToNull(request.instructions),
    })
    .returning()
    .get();
}

/** Checks the agent's CLI (its version command) and records the result as its status. */
export async function validateAgent(
  deps: AgentDeps,
  id: string,
): Promise<{ agent: AgentRow; version: string | null; message: string | null }> {
  const row = getAgent(deps.db, id);
  const adapter = adapterFor(row.adapter);
  const config = agentConfig(row);
  const env = adapter.prepareEnvironment(config, await deps.environment());
  const result = await adapter.validate(config, deps.adapters, env);
  const agent =
    deps.db
      .update(agents)
      .set({ status: result.status })
      .where(eq(agents.id, id))
      .returning()
      .get() ?? getAgent(deps.db, id);
  return result.status === 'ready'
    ? { agent, version: result.version, message: null }
    : { agent, version: null, message: result.message };
}

export function toAgentValidation(
  result: Awaited<ReturnType<typeof validateAgent>>,
): AgentValidation {
  return { ...result, agent: toAgent(result.agent) };
}
