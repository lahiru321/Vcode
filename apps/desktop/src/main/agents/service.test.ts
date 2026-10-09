import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterContext } from '@vcode/adapters';
import { Agent, CreateAgentRequest, IpcError, UpdateAgentRequest } from '@vcode/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '../db';
import { createProject, deleteProject } from '../projects/service';
import { ensureMainWorkspace } from '../workspaces/service';
import { createAgentSession, setAgentSessionStatus } from './sessions';
import { tempDir, testDatabase } from '../testing';
import {
  createAgent,
  deleteAgent,
  detectAgent,
  getAgent,
  listAgents,
  listProviders,
  toAgent,
  updateAgent,
  validateAgent,
  type AgentDeps,
} from './service';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function project(db: AppDatabase, name = 'app') {
  const dir = join(tempDir(), name);
  mkdirSync(dir);
  return createProject(db, { rootPath: dir });
}

function deps(db: AppDatabase, adapters: Partial<AdapterContext> = {}): AgentDeps {
  return {
    db,
    adapters: {
      platform: {
        resolveExecutable: async (command) => ({ path: `/bin/${command}`, kind: 'binary' }),
        buildCommand: (executable, args) => ({
          file: executable.path,
          args,
          verbatimArguments: false,
        }),
      },
      run: async () => ({ exitCode: 0, stdout: '2.1.0', stderr: '', timedOut: false }),
      ...adapters,
    },
    environment: async () => ({ PATH: '/bin', CLAUDECODE: '1' }),
  };
}

describe('createAgent', () => {
  it('creates a global Claude agent with defaults', () => {
    const db = testDatabase();
    const agent = createAgent(db, { name: 'Claude Code', adapter: 'claude' });
    expect(toAgent(agent)).toMatchObject({
      projectId: null,
      name: 'Claude Code',
      adapter: 'claude',
      executable: 'claude',
      args: [],
      env: {},
      model: null,
      role: null,
      instructions: null,
      status: 'unvalidated',
    });
    // The IPC response schema accepts it.
    expect(Agent.safeParse(toAgent(agent)).success).toBe(true);
  });

  it('keeps the given settings; blank text becomes null', async () => {
    const db = testDatabase();
    const p = await project(db);
    const agent = createAgent(db, {
      projectId: p.id,
      name: 'Backend',
      adapter: 'claude',
      executable: ' D:\\claude.exe ',
      args: ['--verbose'],
      env: { FOO: 'bar' },
      model: 'opus',
      role: '  ',
      instructions: 'Be brief.',
    });
    expect(toAgent(agent)).toMatchObject({
      projectId: p.id,
      executable: 'D:\\claude.exe',
      args: ['--verbose'],
      env: { FOO: 'bar' },
      model: 'opus',
      role: null,
      instructions: 'Be brief.',
    });
  });

  it('a custom CLI needs a command; unknown projects are refused', () => {
    const db = testDatabase();
    expect(() => createAgent(db, { name: 'X', adapter: 'custom' })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST', message: 'Enter the command to run.' }),
    );
    const custom = createAgent(db, { name: 'Aider', adapter: 'custom', executable: ' aider ' });
    expect(custom.executable).toBe('aider');
    expect(() => updateAgent(db, { id: custom.id, executable: ' ' })).toThrow(IpcError);
    expect(() => createAgent(db, { name: 'C', adapter: 'claude', projectId: MISSING_ID })).toThrow(
      /not found/i,
    );
  });
});

describe('CreateAgentRequest', () => {
  it('rejects bad environment names and unknown keys', () => {
    const base = { name: 'C', adapter: 'claude' };
    expect(CreateAgentRequest.safeParse({ ...base, env: { 'A=B': 'x' } }).success).toBe(false);
    expect(CreateAgentRequest.safeParse({ ...base, apiKey: 'sk-x' }).success).toBe(false);
    expect(CreateAgentRequest.safeParse({ ...base, credentialId: MISSING_ID }).success).toBe(true);
    expect(CreateAgentRequest.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(CreateAgentRequest.safeParse({ ...base, env: { A_1: 'x' } }).success).toBe(true);
  });
});

describe('updateAgent', () => {
  it('changes only the given fields; blank text becomes null', async () => {
    const db = testDatabase();
    const p = await project(db);
    const agent = createAgent(db, {
      name: 'C',
      adapter: 'claude',
      args: ['--a'],
      model: 'opus',
      role: 'Reviewer',
    });
    const updated = updateAgent(db, {
      id: agent.id,
      projectId: p.id,
      name: 'Renamed',
      model: ' ',
      args: [],
    });
    expect(toAgent(updated)).toMatchObject({
      projectId: p.id,
      name: 'Renamed',
      executable: 'claude',
      args: [],
      model: null,
      role: 'Reviewer',
    });
    // Back to global.
    expect(updateAgent(db, { id: agent.id, projectId: null }).projectId).toBeNull();
  });

  it('a new executable resets the status; the same one keeps it; blank = the default', () => {
    const db = testDatabase();
    const agent = createAgent(db, { name: 'C', adapter: 'claude', executable: 'D:\\claude.exe' });
    db.$client.prepare("update agents set status = 'ready'").run();
    expect(updateAgent(db, { id: agent.id, executable: 'D:\\claude.exe' }).status).toBe('ready');
    const changed = updateAgent(db, { id: agent.id, executable: ' ' });
    expect(changed).toMatchObject({ executable: 'claude', status: 'unvalidated' });
  });

  it('NOT_FOUND for an unknown agent or project', () => {
    const db = testDatabase();
    const agent = createAgent(db, { name: 'C', adapter: 'claude' });
    expect(() => updateAgent(db, { id: MISSING_ID, name: 'x' })).toThrow(/not found/i);
    expect(() => updateAgent(db, { id: agent.id, projectId: MISSING_ID })).toThrow(/not found/i);
  });

  it('the request needs a change and cannot switch provider', () => {
    expect(UpdateAgentRequest.safeParse({ id: MISSING_ID }).success).toBe(false);
    expect(UpdateAgentRequest.safeParse({ id: MISSING_ID, adapter: 'gemini' }).success).toBe(false);
    expect(UpdateAgentRequest.safeParse({ id: MISSING_ID, model: null }).success).toBe(true);
  });
});

describe('deleteAgent', () => {
  it('deletes an agent and its ended sessions', async () => {
    const db = testDatabase();
    const p = await project(db);
    const agent = createAgent(db, { name: 'C', adapter: 'claude' });
    const session = createAgentSession(db, agent.id, ensureMainWorkspace(db, p).id);
    setAgentSessionStatus(db, session.id, 'completed');
    expect(deleteAgent(db, agent.id)).toEqual({ id: agent.id });
    expect(listAgents(db)).toEqual([]);
    expect(db.$client.prepare('select count(*) as n from agent_sessions').get()).toEqual({ n: 0 });
    expect(() => deleteAgent(db, agent.id)).toThrow(/not found/i);
  });

  it('CONFLICT while the agent is running', async () => {
    const db = testDatabase();
    const p = await project(db);
    const agent = createAgent(db, { name: 'C', adapter: 'claude' });
    const session = createAgentSession(db, agent.id, ensureMainWorkspace(db, p).id);
    setAgentSessionStatus(db, session.id, 'working');
    expect(() => deleteAgent(db, agent.id)).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(getAgent(db, agent.id).id).toBe(agent.id);
  });
});

describe('listAgents', () => {
  it("lists global agents plus the project's own, by name", async () => {
    const db = testDatabase();
    const a = await project(db, 'a');
    const b = await project(db, 'b');
    createAgent(db, { name: 'zeta', adapter: 'claude' });
    createAgent(db, { name: 'Alpha', adapter: 'claude', projectId: a.id });
    createAgent(db, { name: 'beta', adapter: 'claude', projectId: b.id });

    expect(listAgents(db, a.id).map((agent) => agent.name)).toEqual(['Alpha', 'zeta']);
    expect(listAgents(db).map((agent) => agent.name)).toEqual(['zeta']);
    expect(() => listAgents(db, MISSING_ID)).toThrow(/not found/i);
  });

  it('deleting a project deletes its agents, not global ones', async () => {
    const db = testDatabase();
    const p = await project(db);
    const own = createAgent(db, { name: 'own', adapter: 'claude', projectId: p.id });
    createAgent(db, { name: 'global', adapter: 'claude' });
    deleteProject(db, p.id);
    expect(() => getAgent(db, own.id)).toThrow(/not found/i);
    expect(listAgents(db).map((agent) => agent.name)).toEqual(['global']);
  });
});

describe('validateAgent', () => {
  it("records `ready` and returns the version, with the adapter's environment", async () => {
    const db = testDatabase();
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: '2.1.0 (Claude Code)',
      stderr: '',
      timedOut: false,
    }));
    const agent = createAgent(db, { name: 'C', adapter: 'claude', env: { FOO: 'bar' } });
    const result = await validateAgent(deps(db, { run }), agent.id);
    expect(result).toMatchObject({ agent: { status: 'ready' }, version: '2.1.0', message: null });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ file: '/bin/claude' }), {
      env: { PATH: '/bin', FOO: 'bar' },
      timeoutMs: expect.any(Number),
    });
    expect(getAgent(db, agent.id).status).toBe('ready');
  });

  it('records `not_found` with a message', async () => {
    const db = testDatabase();
    const agent = createAgent(db, { name: 'C', adapter: 'claude' });
    const result = await validateAgent(
      deps(db, {
        platform: {
          resolveExecutable: async () => null,
          buildCommand: () => {
            throw new Error('unused');
          },
        },
      }),
      agent.id,
    );
    expect(result.agent.status).toBe('not_found');
    expect(result.message).toMatch(/not found/);
  });

  it('NOT_FOUND for an unknown agent', async () => {
    await expect(validateAgent(deps(testDatabase()), MISSING_ID)).rejects.toThrow(/not found/i);
  });
});

describe('listProviders', () => {
  it('lists the providers that have an adapter', () => {
    expect(listProviders()).toEqual([
      {
        id: 'claude',
        displayName: 'Claude Code',
        defaultExecutable: 'claude',
        supportsInstructions: true,
        supportsModel: true,
        apiKeyEnv: 'ANTHROPIC_API_KEY',
      },
      {
        id: 'gemini',
        displayName: 'Gemini CLI',
        defaultExecutable: 'gemini',
        supportsInstructions: false,
        supportsModel: true,
        apiKeyEnv: 'GEMINI_API_KEY',
      },
      {
        id: 'codex',
        displayName: 'Codex CLI',
        defaultExecutable: 'codex',
        supportsInstructions: true,
        supportsModel: true,
        apiKeyEnv: 'OPENAI_API_KEY',
      },
      {
        id: 'custom',
        displayName: 'Custom CLI',
        defaultExecutable: '',
        supportsInstructions: false,
        supportsModel: false,
        apiKeyEnv: null,
      },
    ]);
  });
});

describe('detectAgent', () => {
  it("finds the provider's default CLI and returns its path and version", async () => {
    const db = testDatabase();
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: '2.1.0 (Claude Code)',
      stderr: '',
      timedOut: false,
    }));
    await expect(detectAgent(deps(db, { run }), { adapter: 'claude' })).resolves.toEqual({
      status: 'ready',
      path: '/bin/claude',
      version: '2.1.0',
      message: null,
    });
    // The adapter's environment: Claude's nesting variable is dropped.
    expect(run).toHaveBeenCalledWith(expect.anything(), {
      env: { PATH: '/bin' },
      timeoutMs: expect.any(Number),
    });
    // Nothing is saved.
    expect(listAgents(db)).toEqual([]);
  });

  it('uses the given executable; blank means the default', async () => {
    const resolveExecutable = vi.fn(async (command: string) => ({
      path: command,
      kind: 'binary' as const,
    }));
    const d = deps(testDatabase(), {
      platform: {
        resolveExecutable,
        buildCommand: (executable, args) => ({
          file: executable.path,
          args,
          verbatimArguments: false,
        }),
      },
    });
    await detectAgent(d, { adapter: 'claude', executable: ' D:\\tools\\claude.exe ' });
    await detectAgent(d, { adapter: 'claude', executable: '  ' });
    expect(resolveExecutable.mock.calls.map(([command]) => command)).toEqual([
      'D:\\tools\\claude.exe',
      'claude',
    ]);
  });

  it('reports a missing CLI and a failing one', async () => {
    const db = testDatabase();
    const missing = await detectAgent(
      deps(db, {
        platform: {
          resolveExecutable: async () => null,
          buildCommand: () => {
            throw new Error('unused');
          },
        },
      }),
      { adapter: 'claude' },
    );
    expect(missing).toMatchObject({ status: 'not_found', path: null, message: /not found/ });

    const failing = await detectAgent(
      deps(db, {
        run: async () => ({ exitCode: 1, stdout: '', stderr: 'boom', timedOut: false }),
      }),
      { adapter: 'claude' },
    );
    expect(failing).toMatchObject({ status: 'error', path: '/bin/claude', message: /boom/ });
  });

  it('asks for a command for a custom CLI, and never runs it to check it', async () => {
    const run = vi.fn();
    const d = deps(testDatabase(), { run });
    await expect(detectAgent(d, { adapter: 'custom' })).resolves.toMatchObject({
      status: 'not_found',
      message: 'Enter the command to run.',
    });
    await expect(detectAgent(d, { adapter: 'custom', executable: 'aider' })).resolves.toEqual({
      status: 'ready',
      path: '/bin/aider',
      version: null,
      message: null,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
