import {
  getAdapter,
  listAdapters,
  type AdapterContext,
  type AgentAdapter,
  type AgentConfig,
} from '@vcode/adapters';
import {
  AGENT_ADAPTERS,
  IpcError,
  type Agent,
  type AgentDetection,
  type AgentProvider,
  type AgentValidation,
  ACTIVE_AGENT_SESSION_STATUSES,
  type CreateAgentRequest,
  type DetectAgentRequest,
  type UpdateAgentRequest,
} from '@vcode/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { agents, agentSessions } from '../db/schema';
import type { Environment } from '../platform';
import { getCredential } from '../credentials/service';
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

/** The providers the app has an adapter for. */
export function listProviders(): AgentProvider[] {
  return listAdapters().flatMap((adapter) => {
    const id = AGENT_ADAPTERS.find((known) => known === adapter.id);
    return id
      ? [
          {
            id,
            displayName: adapter.displayName,
            defaultExecutable: adapter.defaultExecutable,
            supportsInstructions: adapter.supportsInstructions,
            supportsModel: adapter.supportsModel,
            apiKeyEnv: adapter.apiKeyEnv,
          },
        ]
      : [];
  });
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

/** The executable to save: the given one, else the adapter's default. Custom CLIs need one. */
function executableFor(adapter: AgentAdapter, executable: string | undefined): string {
  const value = executable?.trim() || adapter.defaultExecutable;
  if (!value) {
    throw new IpcError('INVALID_REQUEST', 'Enter the command to run.');
  }
  return value;
}

export function createAgent(db: AppDatabase, request: CreateAgentRequest): AgentRow {
  const adapter = adapterFor(request.adapter);
  const projectId = request.projectId ?? null;
  if (projectId) {
    getProject(db, projectId);
  }
  if (request.credentialId) {
    getCredential(db, request.credentialId);
  }
  return db
    .insert(agents)
    .values({
      projectId,
      name: request.name,
      adapter: request.adapter,
      executable: executableFor(adapter, request.executable),
      argsJson: request.args ?? [],
      envJson: request.env ?? {},
      model: blankToNull(request.model),
      role: blankToNull(request.role),
      instructions: blankToNull(request.instructions),
      credentialId: request.credentialId ?? null,
    })
    .returning()
    .get();
}

/** Changes the given fields. The agent's running sessions keep the settings they started with. */
export function updateAgent(db: AppDatabase, request: UpdateAgentRequest): AgentRow {
  const row = getAgent(db, request.id);
  const adapter = adapterFor(row.adapter);
  if (request.projectId) {
    getProject(db, request.projectId);
  }
  if (request.credentialId) {
    getCredential(db, request.credentialId);
  }
  const executable =
    request.executable === undefined ? undefined : executableFor(adapter, request.executable);
  const text = (value: string | null | undefined) =>
    value === undefined ? undefined : blankToNull(value);
  return (
    db
      .update(agents)
      .set({
        projectId: request.projectId,
        name: request.name,
        executable,
        argsJson: request.args,
        envJson: request.env,
        model: text(request.model),
        role: text(request.role),
        instructions: text(request.instructions),
        credentialId: request.credentialId,
        // A different CLI hasn't been checked yet.
        ...(executable !== undefined && executable !== row.executable
          ? { status: 'unvalidated' as const }
          : {}),
      })
      .where(eq(agents.id, row.id))
      .returning()
      .get() ?? getAgent(db, row.id)
  );
}

/**
 * Deletes the agent and its ended sessions (their terminals stay, as plain terminals).
 * CONFLICT while one of its sessions may still be running.
 */
export function deleteAgent(db: AppDatabase, id: string): { id: string } {
  const row = getAgent(db, id);
  const running = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.agentId, id),
        inArray(agentSessions.status, [...ACTIVE_AGENT_SESSION_STATUSES]),
      ),
    )
    .get();
  if (running) {
    throw new IpcError('CONFLICT', `“${row.name}” is running. Stop it before deleting it.`);
  }
  db.delete(agents).where(eq(agents.id, id)).run();
  return { id };
}

/** Runs the adapter's check with the environment the agent would start with. */
async function check(deps: AgentDeps, adapter: AgentAdapter, config: AgentConfig) {
  const env = adapter.prepareEnvironment(config, await deps.environment());
  return adapter.validate(config, deps.adapters, env);
}

/**
 * Looks for a provider's CLI (the given executable, else its default) and runs its version
 * check, without saving anything: the Add Agent dialog's auto-detect.
 */
export async function detectAgent(
  deps: AgentDeps,
  request: DetectAgentRequest,
): Promise<AgentDetection> {
  const adapter = adapterFor(request.adapter);
  const result = await check(deps, adapter, {
    name: adapter.displayName,
    executable: request.executable?.trim() || adapter.defaultExecutable,
    args: [],
    env: {},
    model: null,
    role: null,
    instructions: null,
  });
  switch (result.status) {
    case 'ready':
      return {
        status: 'ready',
        path: result.executable.path,
        version: result.version,
        message: null,
      };
    case 'not_found':
      return { status: 'not_found', path: null, version: null, message: result.message };
    case 'error':
      return {
        status: 'error',
        path: result.executable?.path ?? null,
        version: null,
        message: result.message,
      };
  }
}

/** Checks the agent's CLI (its version command) and records the result as its status. */
export async function validateAgent(
  deps: AgentDeps,
  id: string,
): Promise<{ agent: AgentRow; version: string | null; message: string | null }> {
  const row = getAgent(deps.db, id);
  const result = await check(deps, adapterFor(row.adapter), agentConfig(row));
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
