import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminalSessions, workspaces } from '../db/schema';
import { createProject, updateProject } from '../projects/service';
import { PtyHostError } from '../pty-host/supervisor';
import { tempDir, testDatabase } from '../testing';
import {
  attachTerminal,
  closeTerminal,
  createTerminal,
  endActiveSessions,
  failStaleSessions,
  getTerminal,
  listTerminals,
  recordTerminalExit,
  restartTerminal,
  stopTerminal,
  type TerminalDeps,
} from './service';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const SHELL = {
  shell: '/bin/zsh',
  command: { file: '/bin/zsh', args: ['-l'], verbatimArguments: false },
};

function setup(
  hostRequest: TerminalDeps['host']['request'] = vi.fn(async () => ({ pid: 999 })) as never,
) {
  const db = testDatabase();
  const deps: TerminalDeps = {
    db,
    host: { request: hostRequest },
    environment: async () => ({ PATH: '/usr/bin' }),
    resolveShell: async () => SHELL,
    killProcessTree: vi.fn(async () => {}),
  };
  return {
    db,
    deps,
    request: hostRequest as ReturnType<typeof vi.fn>,
    killProcessTree: deps.killProcessTree as ReturnType<typeof vi.fn>,
  };
}

async function project(db: TerminalDeps['db'], name = 'app') {
  const dir = join(tempDir(), name);
  mkdirSync(dir);
  return createProject(db, { rootPath: dir });
}

let cleanupDb: TerminalDeps['db'] | undefined;
afterEach(() => {
  // Sessions of "this run" are module state; end them so tests don't see each other's.
  if (cleanupDb) endActiveSessions(cleanupDb, 'stopped');
  cleanupDb = undefined;
});

describe('createTerminal', () => {
  it("starts a shell in the project's main workspace and records it", async () => {
    const { db, deps, request } = setup();
    cleanupDb = db;
    const p = await project(db);
    const terminal = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });

    expect(terminal).toMatchObject({
      title: 'zsh',
      shell: '/bin/zsh',
      cwd: p.rootPath,
      pid: 999,
      cols: 80,
      rows: 24,
      status: 'running',
      exitCode: null,
      endedAt: null,
    });
    expect(request).toHaveBeenCalledWith('spawn', {
      sessionId: terminal.id,
      file: '/bin/zsh',
      args: ['-l'],
      cwd: p.rootPath,
      env: { PATH: '/usr/bin' },
      cols: 80,
      rows: 24,
    });

    const [workspace] = db.select().from(workspaces).all();
    expect(workspace).toMatchObject({
      projectId: p.id,
      name: 'main',
      kind: 'main',
      path: p.rootPath,
    });
    expect(terminal.workspaceId).toBe(workspace!.id);
  });

  it('reuses the main workspace and accepts a title', async () => {
    const { db, deps } = setup();
    cleanupDb = db;
    const p = await project(db);
    const first = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    const second = await createTerminal(deps, {
      projectId: p.id,
      cols: 80,
      rows: 24,
      title: 'Build',
    });
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(second.title).toBe('Build');
    expect(db.select().from(workspaces).all()).toHaveLength(1);
  });

  it('passes a pre-quoted Windows command line as one string', async () => {
    const { db, deps, request } = setup();
    cleanupDb = db;
    deps.resolveShell = async () => ({
      // OS-native path: the title comes from path.basename, which follows the OS.
      shell: join('/x', 'shell.cmd'),
      command: {
        file: 'C:\\Windows\\System32\\cmd.exe',
        args: ['/d', '/s', '/c', '"x"'],
        verbatimArguments: true,
      },
    });
    const p = await project(db);
    const terminal = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    expect(request.mock.calls[0]![1]).toMatchObject({ args: '/d /s /c "x"' });
    expect(terminal.title).toBe('shell');
  });

  it('refuses archived projects, unknown projects and foreign workspaces', async () => {
    const { db, deps } = setup();
    const a = await project(db, 'a');
    const b = await project(db, 'b');
    const bTerminal = await createTerminal(deps, { projectId: b.id, cols: 80, rows: 24 });
    cleanupDb = db;

    await expect(
      createTerminal(deps, {
        projectId: a.id,
        workspaceId: bTerminal.workspaceId,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createTerminal(deps, { projectId: MISSING_ID, cols: 80, rows: 24 }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    updateProject(db, { id: a.id, status: 'archived' });
    await expect(
      createTerminal(deps, { projectId: a.id, cols: 80, rows: 24 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses a workspace folder that no longer exists, before starting anything', async () => {
    const { db, deps, request } = setup();
    const p = await project(db);
    rmSync(p.rootPath, { recursive: true });
    await expect(
      createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(request).not.toHaveBeenCalled();
    expect(db.select().from(terminalSessions).all()).toEqual([]);
  });

  it('marks the session failed when the host cannot start it', async () => {
    const { db, deps } = setup(
      vi.fn(async () => {
        throw new PtyHostError('failed', 'File not found');
      }) as never,
    );
    const p = await project(db);
    await expect(
      createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 }),
    ).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'Could not start the terminal: File not found',
    });
    const [row] = db.select().from(terminalSessions).all();
    expect(row).toMatchObject({ status: 'failed', pid: null });
    expect(row!.endedAt).toEqual(expect.any(Number));
  });

  it('reports a stopped host as UNAVAILABLE', async () => {
    const { db, deps } = setup(
      vi.fn(async () => {
        throw new PtyHostError('unavailable', 'The terminal host is not running (failed).');
      }) as never,
    );
    const p = await project(db);
    await expect(
      createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 }),
    ).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
});

describe('session lifecycle', () => {
  it('records an exit with its code', async () => {
    const { db, deps } = setup();
    cleanupDb = db;
    const p = await project(db);
    const t = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    recordTerminalExit(db, { sessionId: t.id, exitCode: 3, signal: null });
    expect(getTerminal(db, t.id)).toMatchObject({
      status: 'exited',
      exitCode: 3,
      endedAt: expect.any(Number),
    });
    // Ended sessions are no longer touched when the host goes away.
    endActiveSessions(db, 'failed');
    expect(getTerminal(db, t.id).status).toBe('exited');
  });

  it("ends only this run's active sessions when the host goes away", async () => {
    const { db, deps } = setup();
    cleanupDb = db;
    const p = await project(db);
    const live = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    // A row left "running" by an earlier, crashed run of the app (P2-09 handles those).
    const stale = db
      .insert(terminalSessions)
      .values({
        workspaceId: live.workspaceId,
        title: 'old',
        shell: 'x',
        cwd: 'x',
        cols: 1,
        rows: 1,
        status: 'running',
      })
      .returning()
      .get();

    expect(endActiveSessions(db, 'failed')).toEqual([999]);
    expect(getTerminal(db, live.id)).toMatchObject({
      status: 'failed',
      endedAt: expect.any(Number),
    });
    expect(getTerminal(db, stale.id).status).toBe('running');
    expect(endActiveSessions(db, 'failed')).toEqual([]);
  });

  it('marks sessions left active by an earlier run as failed at launch', async () => {
    const { db, deps } = setup();
    cleanupDb = db;
    const p = await project(db);
    const left = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    const ended = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    recordTerminalExit(db, { sessionId: ended.id, exitCode: 0, signal: null });

    expect(failStaleSessions(db)).toEqual([
      { id: left.id, pid: 999, shell: '/bin/zsh', startedAt: left.startedAt },
    ]);
    expect(getTerminal(db, left.id)).toMatchObject({
      status: 'failed',
      endedAt: expect.any(Number),
    });
    expect(getTerminal(db, ended.id).status).toBe('exited');
    expect(failStaleSessions(db)).toEqual([]);
  });

  it('records a terminal closed by the app as stopped', async () => {
    const { db, deps } = setup();
    cleanupDb = db;
    const p = await project(db);
    const t = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    recordTerminalExit(db, { sessionId: t.id, exitCode: 0, signal: null }, 'stopped');
    expect(getTerminal(db, t.id)).toMatchObject({ status: 'stopped', exitCode: 0 });
    expect(endActiveSessions(db, 'stopped')).toEqual([]); // nothing left to kill
  });
});

describe('stopTerminal / restartTerminal / closeTerminal', () => {
  async function running() {
    const { db, deps, request, killProcessTree } = setup();
    cleanupDb = db;
    const p = await project(db);
    const t = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    return { db, deps, request, killProcessTree, p, t };
  }

  it('stops a terminal by ending its process tree, and keeps it stopped when the exit arrives', async () => {
    const { db, deps, killProcessTree, t } = await running();
    const stopped = await stopTerminal(deps, t.id);
    expect(killProcessTree).toHaveBeenCalledExactlyOnceWith(999);
    expect(stopped).toMatchObject({ id: t.id, status: 'stopped', endedAt: expect.any(Number) });
    recordTerminalExit(db, { sessionId: t.id, exitCode: 1, signal: null });
    expect(getTerminal(db, t.id).status).toBe('stopped');
    expect(endActiveSessions(db, 'failed')).toEqual([]); // no longer this run's to clean up
  });

  it('records `stopped` when the exit arrives while the tree is being killed', async () => {
    const { db, deps, killProcessTree, t } = await running();
    killProcessTree.mockImplementationOnce(async () => {
      recordTerminalExit(db, { sessionId: t.id, exitCode: 1, signal: null });
    });
    const stopped = await stopTerminal(deps, t.id);
    expect(stopped).toMatchObject({ status: 'stopped', exitCode: 1 });
  });

  it('leaves a terminal that already ended alone', async () => {
    const { db, deps, killProcessTree, t } = await running();
    recordTerminalExit(db, { sessionId: t.id, exitCode: 0, signal: null });
    await expect(stopTerminal(deps, t.id)).resolves.toMatchObject({ status: 'exited' });
    expect(killProcessTree).not.toHaveBeenCalled();
  });

  it('reports a failed kill and leaves the terminal running', async () => {
    const { db, deps, killProcessTree, t } = await running();
    killProcessTree.mockRejectedValueOnce(new Error('access denied'));
    await expect(stopTerminal(deps, t.id)).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining('access denied'),
    });
    expect(getTerminal(db, t.id).status).toBe('running');
    recordTerminalExit(db, { sessionId: t.id, exitCode: 0, signal: null });
    expect(getTerminal(db, t.id).status).toBe('exited'); // not mistaken for a stop
  });

  it('refuses to stop a terminal that is still starting', async () => {
    const { db, deps, t } = await running();
    db.update(terminalSessions)
      .set({ status: 'starting', pid: null })
      .where(eq(terminalSessions.id, t.id))
      .run();
    await expect(stopTerminal(deps, t.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('restarts a terminal as a new one in the same place', async () => {
    const { db, deps, request, killProcessTree, t } = await running();
    const restarted = await restartTerminal(deps, t.id);
    expect(killProcessTree).toHaveBeenCalledWith(999);
    expect(getTerminal(db, t.id).status).toBe('stopped');
    expect(restarted.id).not.toBe(t.id);
    expect(restarted).toMatchObject({
      workspaceId: t.workspaceId,
      cwd: t.cwd,
      title: t.title,
      status: 'running',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('restarts a terminal that has already ended without killing anything', async () => {
    const { db, deps, killProcessTree, t } = await running();
    recordTerminalExit(db, { sessionId: t.id, exitCode: 0, signal: null });
    const restarted = await restartTerminal(deps, t.id);
    expect(killProcessTree).not.toHaveBeenCalled();
    expect(restarted.status).toBe('running');
  });

  it('closes a terminal by stopping it', async () => {
    const { db, deps, killProcessTree, t } = await running();
    await expect(closeTerminal(deps, t.id)).resolves.toEqual({ terminalId: t.id });
    expect(killProcessTree).toHaveBeenCalledWith(999);
    expect(getTerminal(db, t.id).status).toBe('stopped');
  });

  it('refuses an unknown terminal', async () => {
    const { deps } = await running();
    await expect(stopTerminal(deps, MISSING_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(restartTerminal(deps, MISSING_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(closeTerminal(deps, MISSING_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('attachTerminal', () => {
  it('hands the port to the host with an attach request', async () => {
    const { db, deps, request } = setup();
    cleanupDb = db;
    const p = await project(db);
    const t = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    const port = { fake: 'port' };
    await attachTerminal(deps, t.id, port);
    expect(request).toHaveBeenLastCalledWith('attach', { sessionId: t.id }, { transfer: [port] });
  });

  it('refuses a terminal that has ended or does not exist', async () => {
    const { db, deps, request } = setup();
    cleanupDb = db;
    const p = await project(db);
    const t = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    recordTerminalExit(db, { sessionId: t.id, exitCode: 0, signal: null });
    request.mockClear();
    await expect(attachTerminal(deps, t.id, {})).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(attachTerminal(deps, MISSING_ID, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('maps host failures to IPC errors', async () => {
    const { db, deps, request } = setup();
    cleanupDb = db;
    const p = await project(db);
    const t = await createTerminal(deps, { projectId: p.id, cols: 80, rows: 24 });
    request.mockRejectedValueOnce(new PtyHostError('unavailable', 'not running'));
    await expect(attachTerminal(deps, t.id, {})).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    request.mockRejectedValueOnce(new PtyHostError('failed', 'No running terminal x'));
    await expect(attachTerminal(deps, t.id, {})).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'Could not connect to the terminal: No running terminal x',
    });
  });
});

describe('listTerminals', () => {
  it("lists one project's terminals, oldest first", async () => {
    const { db, deps } = setup();
    cleanupDb = db;
    const a = await project(db, 'a');
    const b = await project(db, 'b');
    const first = await createTerminal(deps, { projectId: a.id, cols: 80, rows: 24, title: 'one' });
    await createTerminal(deps, { projectId: b.id, cols: 80, rows: 24 });
    db.update(terminalSessions)
      .set({ startedAt: 1 })
      .where(eq(terminalSessions.id, first.id))
      .run();
    await createTerminal(deps, { projectId: a.id, cols: 80, rows: 24, title: 'two' });

    expect(listTerminals(db, a.id).map((t) => t.title)).toEqual(['one', 'two']);
    expect(() => listTerminals(db, MISSING_ID)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});
