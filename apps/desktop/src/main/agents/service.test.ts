import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterContext } from '@vcode/adapters';
import { Agent, CreateAgentRequest, IpcError } from '@vcode/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '../db';
import { createProject, deleteProject } from '../projects/service';
import { tempDir, testDatabase } from '../testing';
import {
  createAgent,
  getAgent,
  listAgents,
  toAgent,
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

  it('refuses providers without an adapter and unknown projects', () => {
    const db = testDatabase();
    expect(() => createAgent(db, { name: 'G', adapter: 'gemini' })).toThrow(IpcError);
    expect(() => createAgent(db, { name: 'C', adapter: 'claude', projectId: MISSING_ID })).toThrow(
      /not found/i,
    );
  });
});

describe('CreateAgentRequest', () => {
  it('rejects bad environment names and unknown keys', () => {
    const base = { name: 'C', adapter: 'claude' };
    expect(CreateAgentRequest.safeParse({ ...base, env: { 'A=B': 'x' } }).success).toBe(false);
    expect(CreateAgentRequest.safeParse({ ...base, credentialId: MISSING_ID }).success).toBe(false);
    expect(CreateAgentRequest.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(CreateAgentRequest.safeParse({ ...base, env: { A_1: 'x' } }).success).toBe(true);
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
