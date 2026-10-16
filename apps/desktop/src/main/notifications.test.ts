import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from './agents/service';
import { createAgentSession, setAgentSessionStatus } from './agents/sessions';
import type * as DbModule from './db';
import type { AppDatabase } from './db';
import { terminalSessions } from './db/schema';
import { broadcastEvent } from './ipc';
import { notificationText, startNotifications } from './notifications';
import { createProject } from './projects/service';
import { updateSettings } from './settings/store';
import { tempDir, testDatabase } from './testing';
import { ensureMainWorkspace } from './workspaces/service';

const shown: { title: string; body: string; handlers: Record<string, () => void> }[] = [];

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => true;
    handlers: Record<string, () => void> = {};
    constructor(readonly options: { title: string; body: string }) {}
    on(event: string, handler: () => void) {
      this.handlers[event] = handler;
    }
    show() {
      shown.push({ ...this.options, handlers: this.handlers });
    }
  },
  Menu: {},
  nativeImage: {},
  Tray: class {},
  shell: {},
}));
vi.mock('./ipc', () => ({ broadcastEvent: vi.fn() }));
let db: AppDatabase;
vi.mock('./db', async (importActual) => ({
  ...(await importActual<typeof DbModule>()),
  getDatabase: () => db,
}));

async function setup() {
  db = testDatabase();
  const root = join(tempDir(), 'shop');
  mkdirSync(root);
  const project = await createProject(db, { rootPath: root });
  const workspace = ensureMainWorkspace(db, project);
  const agent = createAgent(db, { name: 'Claude Code', adapter: 'claude' });
  const run = createAgentSession(db, agent.id, workspace.id);
  const terminal = db
    .insert(terminalSessions)
    .values({
      workspaceId: workspace.id,
      agentSessionId: run.id,
      title: 'Claude Code',
      shell: 'claude',
      cwd: root,
      cols: 80,
      rows: 24,
      status: 'running',
    })
    .returning()
    .get();
  setAgentSessionStatus(db, run.id, 'working');
  return { project, run, terminal };
}

describe('notificationText', () => {
  const run = { agentName: 'Codex', projectName: 'blog' };
  it('announces waiting, finishing and failing; nothing else', () => {
    expect(notificationText('waiting', run)).toEqual({
      title: 'Codex is waiting for input',
      body: 'blog',
    });
    expect(notificationText('completed', run)?.title).toBe('Codex finished');
    expect(notificationText('failed', run)?.title).toBe('Codex stopped with an error');
    for (const status of ['created', 'starting', 'ready', 'working', 'stopped'] as const) {
      expect(notificationText(status, run)).toBeNull();
    }
  });
});

describe('startNotifications', () => {
  let stop: () => void = () => undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    shown.length = 0;
    vi.mocked(broadcastEvent).mockClear();
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('announces a wait once it has lasted, at most once a minute', async () => {
    const { run } = await setup();
    stop = startNotifications(() => null);

    setAgentSessionStatus(db, run.id, 'waiting');
    expect(shown).toHaveLength(0);
    vi.advanceTimersByTime(2_000);
    expect(shown.map((n) => n.title)).toEqual(['Claude Code is waiting for input']);

    // Back to work and waiting again within the minute: quiet.
    setAgentSessionStatus(db, run.id, 'working');
    setAgentSessionStatus(db, run.id, 'waiting');
    vi.advanceTimersByTime(2_000);
    expect(shown).toHaveLength(1);
  });

  it('says nothing about a wait that ends before it settles', async () => {
    const { run } = await setup();
    stop = startNotifications(() => null);
    setAgentSessionStatus(db, run.id, 'waiting');
    vi.advanceTimersByTime(1_000);
    setAgentSessionStatus(db, run.id, 'working');
    vi.advanceTimersByTime(5_000);
    expect(shown).toHaveLength(0);
  });

  it('announces a finished run; a click shows its terminal', async () => {
    const { project, run, terminal } = await setup();
    const hidden = {
      isVisible: () => false,
      isFocused: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      focus: vi.fn(),
    };
    stop = startNotifications(() => hidden as never);
    setAgentSessionStatus(db, run.id, 'completed', 0);
    expect(shown).toMatchObject([{ title: 'Claude Code finished', body: 'shop' }]);

    shown[0]!.handlers['click']!();
    expect(hidden.show).toHaveBeenCalled();
    expect(broadcastEvent).toHaveBeenCalledWith('app:command', {
      command: 'showTerminal',
      projectId: project.id,
      terminalId: terminal.id,
    });
  });

  it('stays quiet when stopped by the user, turned off, or the window is in front', async () => {
    const first = await setup();
    stop = startNotifications(() => null);
    setAgentSessionStatus(db, first.run.id, 'stopped');
    expect(shown).toHaveLength(0);
    stop();

    const second = await setup();
    updateSettings(db, { notifications: false });
    stop = startNotifications(() => null);
    setAgentSessionStatus(db, second.run.id, 'failed', 1);
    expect(shown).toHaveLength(0);
    stop();

    const third = await setup();
    const focused = { isVisible: () => true, isFocused: () => true };
    stop = startNotifications(() => focused as never);
    setAgentSessionStatus(db, third.run.id, 'completed', 0);
    expect(shown).toHaveLength(0);
  });
});
