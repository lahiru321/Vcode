import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agents/service';
import { createAgentSession, setAgentSessionStatus } from '../agents/sessions';
import { auditLogs } from '../db/schema';
import { createProject, deleteProject } from '../projects/service';
import { tempDir, testDatabase } from '../testing';
import { ensureMainWorkspace } from '../workspaces/service';
import { listAudit, pruneAudit, recordAudit, trackAgentRunEnds } from './service';

async function setup() {
  const db = testDatabase();
  const root = join(tempDir(), 'shop');
  mkdirSync(root);
  const project = await createProject(db, { rootPath: root });
  return { db, project };
}

describe('audit log', () => {
  it('records entries with their project, redacting secrets in text', async () => {
    const { db, project } = await setup();
    recordAudit(db, {
      projectId: project.id,
      action: 'agent.update',
      resourceType: 'agent',
      resourceId: 'a1',
      metadata: {
        name: 'Claude',
        changed: 'args',
        note: 'sk-ant-api03-abcdefghijklmnop',
        n: 3,
        skip: undefined,
      },
    });
    const { entries, hasMore } = listAudit(db);
    expect(hasMore).toBe(false);
    expect(entries).toEqual([
      {
        id: expect.any(String),
        projectId: project.id,
        projectName: 'shop',
        action: 'agent.update',
        resourceType: 'agent',
        resourceId: 'a1',
        metadata: { name: 'Claude', changed: 'args', note: '[redacted]', n: 3 },
        createdAt: expect.any(Number),
      },
    ]);
  });

  it('keeps entries when their project is removed, as app-wide', async () => {
    const { db, project } = await setup();
    recordAudit(db, { projectId: project.id, action: 'project.create', resourceType: 'project' });
    deleteProject(db, project.id);
    expect(listAudit(db).entries).toMatchObject([{ projectId: null, projectName: null }]);
  });

  it('pages newest first, without skipping entries from the same millisecond', async () => {
    const { db, project } = await setup();
    const other = await createProject(db, { rootPath: tempDir() });
    for (let i = 0; i < 5; i++) {
      recordAudit(db, {
        projectId: i === 2 ? other.id : project.id,
        action: 'terminal.start',
        resourceType: 'terminal',
        metadata: { i },
      });
    }
    // All in the same millisecond, as a restart's stop and start can be.
    db.update(auditLogs).set({ createdAt: 1000 }).run();

    const first = listAudit(db, { limit: 2 });
    expect(first.entries.map((e) => e.metadata['i'])).toEqual([4, 3]);
    expect(first.hasMore).toBe(true);
    const second = listAudit(db, { limit: 2, after: first.entries.at(-1)!.id });
    expect(second.entries.map((e) => e.metadata['i'])).toEqual([2, 1]);
    const third = listAudit(db, { limit: 2, after: second.entries.at(-1)!.id });
    expect(third).toMatchObject({ hasMore: false });
    expect(third.entries.map((e) => e.metadata['i'])).toEqual([0]);

    expect(listAudit(db, { projectId: other.id }).entries.map((e) => e.metadata['i'])).toEqual([2]);
  });

  it('trims all but the newest entries', async () => {
    const { db } = await setup();
    for (let i = 0; i < 5; i++) {
      recordAudit(db, { action: 'credential.create', resourceType: 'credential', metadata: { i } });
    }
    expect(pruneAudit(db, 2)).toBe(3);
    expect(listAudit(db).entries.map((e) => e.metadata['i'])).toEqual([4, 3]);
  });

  it('records each agent run that ends, not the ones still going', async () => {
    const { db, project } = await setup();
    const stop = trackAgentRunEnds(db);
    const agent = createAgent(db, { name: 'Codex', adapter: 'codex' });
    const run = createAgentSession(db, agent.id, ensureMainWorkspace(db, project).id);
    setAgentSessionStatus(db, run.id, 'working');
    setAgentSessionStatus(db, run.id, 'failed', 2);
    stop();

    expect(listAudit(db).entries).toMatchObject([
      {
        projectId: project.id,
        action: 'agent.end',
        resourceId: run.id,
        metadata: { agent: 'Codex', workspace: 'main', status: 'failed', exitCode: 2 },
      },
    ]);
  });
});
