import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '../agents/service';
import { agentSessionEvents, type AgentSessionUpdate } from '../agents/sessions';
import type { AppDatabase } from '../db';
import { agents, agentSessions } from '../db/schema';
import { createProject } from '../projects/service';
import { PtyHostError } from '../pty-host/supervisor';
import { tempDir, testDatabase } from '../testing';
import {
  createTerminal,
  endActiveSessions,
  failStaleSessions,
  getTerminal,
  recordTerminalActivity,
  recordTerminalExit,
  restartTerminal,
  stopTerminal,
  withAgents,
  type TerminalDeps,
} from './service';

// Terminals that run an agent (P3-04, P3-05).

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

function setup() {
  const db = testDatabase();
  const request = vi.fn(async () => ({ pid: 4242 }));
  const deps: TerminalDeps = {
    db,
    host: { request: request as never },
    environment: async () => ({ PATH: '/usr/bin', CLAUDECODE: '1' }),
    resolveShell: async () => ({
      shell: '/bin/zsh',
      command: { file: '/bin/zsh', args: ['-l'], verbatimArguments: false },
    }),
    killProcessTree: vi.fn(async () => {}),
    adapters: {
      platform: {
        resolveExecutable: async (command) =>
          command === 'missing' ? null : { path: `/bin/${command}`, kind: 'binary' },
        buildCommand: (executable, args) => ({
          file: executable.path,
          args,
          verbatimArguments: false,
        }),
      },
      run: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    },
  };
  const updates: AgentSessionUpdate[] = [];
  const listener = (update: AgentSessionUpdate) => updates.push(update);
  agentSessionEvents.on('status', listener);
  cleanups.push(() => {
    agentSessionEvents.off('status', listener);
    endActiveSessions(db, 'stopped');
  });
  return { db, deps, request, updates };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function project(db: AppDatabase, name = 'app') {
  const dir = join(tempDir(), name);
  mkdirSync(dir);
  return createProject(db, { rootPath: dir });
}

const agentSession = (db: AppDatabase, id: string) =>
  db.select().from(agentSessions).where(eq(agentSessions.id, id)).get();

async function runningAgent() {
  const ctx = setup();
  const p = await project(ctx.db);
  const agent = createAgent(ctx.db, { name: 'Claude Code', adapter: 'claude', model: 'opus' });
  const terminal = await createTerminal(ctx.deps, {
    projectId: p.id,
    agentId: agent.id,
    cols: 100,
    rows: 30,
  });
  return { ...ctx, p, agent, terminal };
}

describe('createTerminal with an agent', () => {
  it("runs the agent's CLI in the project's main workspace", async () => {
    const { db, request, p, agent, terminal, updates } = await runningAgent();
    expect(request).toHaveBeenCalledWith('spawn', {
      sessionId: terminal.id,
      file: '/bin/claude',
      args: ['--model', 'opus'],
      cwd: p.rootPath,
      // The adapter's environment: Claude's nested-session marker is gone.
      env: { PATH: '/usr/bin' },
      cols: 100,
      rows: 30,
      trackActivity: true,
    });
    expect(terminal).toMatchObject({
      title: 'Claude Code',
      shell: '/bin/claude',
      cwd: p.rootPath,
      status: 'running',
      agentSessionId: expect.any(String),
    });
    const session = agentSession(db, terminal.agentSessionId!);
    expect(session).toMatchObject({
      agentId: agent.id,
      workspaceId: terminal.workspaceId,
      status: 'starting',
      endedAt: null,
    });
    expect(updates).toEqual([
      { agentSessionId: session!.id, agentId: agent.id, status: 'starting' },
    ]);
    expect(withAgents(db, [terminal])[0]!.agent).toEqual({
      sessionId: session!.id,
      agentId: agent.id,
      name: 'Claude Code',
      adapter: 'claude',
      status: 'starting',
    });
  });

  it("accepts the project's own agents, not other projects'", async () => {
    const { db, deps } = setup();
    const a = await project(db, 'a');
    const b = await project(db, 'b');
    const own = createAgent(db, { name: 'own', adapter: 'claude', projectId: a.id });
    const other = createAgent(db, { name: 'other', adapter: 'claude', projectId: b.id });
    await expect(
      createTerminal(deps, { projectId: a.id, agentId: own.id, cols: 80, rows: 24 }),
    ).resolves.toMatchObject({ status: 'running' });
    await expect(
      createTerminal(deps, { projectId: a.id, agentId: other.id, cols: 80, rows: 24 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createTerminal(deps, { projectId: a.id, agentId: MISSING_ID, cols: 80, rows: 24 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports a missing CLI before starting anything, and marks the agent', async () => {
    const { db, deps, request } = setup();
    const p = await project(db);
    const agent = createAgent(db, { name: 'C', adapter: 'claude', executable: 'missing' });
    await expect(
      createTerminal(deps, { projectId: p.id, agentId: agent.id, cols: 80, rows: 24 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('Claude Code') });
    expect(request).not.toHaveBeenCalled();
    expect(db.select().from(agentSessions).all()).toEqual([]);
    expect(db.select().from(agents).get()!.status).toBe('not_found');
  });

  it('fails the agent session when the host cannot start it', async () => {
    const { db, deps, request } = setup();
    request.mockRejectedValueOnce(new PtyHostError('failed', 'boom'));
    const p = await project(db);
    const agent = createAgent(db, { name: 'C', adapter: 'claude' });
    await expect(
      createTerminal(deps, { projectId: p.id, agentId: agent.id, cols: 80, rows: 24 }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(db.select().from(agentSessions).get()).toMatchObject({
      status: 'failed',
      endedAt: expect.any(Number),
    });
  });
});

describe('agent session lifecycle', () => {
  it('completes when the agent exits with 0, fails otherwise', async () => {
    const first = await runningAgent();
    recordTerminalExit(first.db, { sessionId: first.terminal.id, exitCode: 0, signal: null });
    expect(agentSession(first.db, first.terminal.agentSessionId!)).toMatchObject({
      status: 'completed',
      exitCode: 0,
      endedAt: expect.any(Number),
    });

    const second = await runningAgent();
    recordTerminalExit(second.db, { sessionId: second.terminal.id, exitCode: 2, signal: null });
    expect(agentSession(second.db, second.terminal.agentSessionId!)).toMatchObject({
      status: 'failed',
      exitCode: 2,
    });
  });

  it('is stopped with its terminal, and stays stopped', async () => {
    const { db, deps, terminal, updates } = await runningAgent();
    await stopTerminal(deps, terminal.id);
    recordTerminalExit(db, { sessionId: terminal.id, exitCode: 1, signal: null });
    expect(agentSession(db, terminal.agentSessionId!)!.status).toBe('stopped');
    expect(updates.map((update) => update.status)).toEqual(['starting', 'stopped']);
  });

  it('fails when the PTY host crashes', async () => {
    const { db, terminal } = await runningAgent();
    endActiveSessions(db, 'failed');
    expect(agentSession(db, terminal.agentSessionId!)!.status).toBe('failed');
  });

  it('fails at launch when an earlier run left it active', async () => {
    const { db, terminal } = await runningAgent();
    failStaleSessions(db);
    expect(agentSession(db, terminal.agentSessionId!)!.status).toBe('failed');
    expect(getTerminal(db, terminal.id).status).toBe('failed');
  });

  it('restarting runs the agent again as a new session', async () => {
    const { db, deps, request, agent, terminal } = await runningAgent();
    const restarted = await restartTerminal(deps, terminal.id);
    expect(restarted.agentSessionId).not.toBe(terminal.agentSessionId);
    expect(agentSession(db, restarted.agentSessionId!)).toMatchObject({
      agentId: agent.id,
      status: 'starting',
    });
    expect(agentSession(db, terminal.agentSessionId!)!.status).toBe('stopped');
    expect(request).toHaveBeenLastCalledWith(
      'spawn',
      expect.objectContaining({ file: '/bin/claude' }),
    );
  });

  it('plain shells have no agent', async () => {
    const { db, deps } = setup();
    const p = await project(db);
    const shell = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    expect(shell.agentSessionId).toBeNull();
    expect(withAgents(db, [shell])[0]!.agent).toBeNull();
  });
});

describe('activity detection (P3-06)', () => {
  it('turns terminal signals into ready / working / waiting', async () => {
    const { db, terminal, updates } = await runningAgent();
    const signal = (s: 'output' | 'idle' | 'bell') =>
      recordTerminalActivity(db, { sessionId: terminal.id, signal: s });
    signal('idle');
    signal('output');
    signal('output');
    signal('idle');
    signal('bell');
    signal('output');
    expect(updates.map((update) => update.status)).toEqual([
      'starting',
      'ready',
      'working',
      'waiting',
      'working',
    ]);
    expect(agentSession(db, terminal.agentSessionId!)!.status).toBe('working');
  });

  it('ignores signals once the agent has ended, and plain shells', async () => {
    const { db, deps, p, terminal, updates } = await runningAgent();
    recordTerminalExit(db, { sessionId: terminal.id, exitCode: 0, signal: null });
    recordTerminalActivity(db, { sessionId: terminal.id, signal: 'idle' });
    expect(agentSession(db, terminal.agentSessionId!)!.status).toBe('completed');

    const shell = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    recordTerminalActivity(db, { sessionId: shell.id, signal: 'idle' });
    recordTerminalActivity(db, { sessionId: MISSING_ID, signal: 'idle' });
    expect(updates.map((update) => update.status)).toEqual(['starting', 'completed']);
  });
});
