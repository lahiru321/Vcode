import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '.';
import { tempDir, testDatabase } from '../testing';
import {
  agentSessions,
  agents,
  auditLogs,
  credentials,
  projects,
  repositories,
  terminalSessions,
  workspaces,
} from './schema';

const V1_TABLES = [
  'agent_sessions',
  'agents',
  'app_settings',
  'audit_logs',
  'credentials',
  'projects',
  'repositories',
  'terminal_sessions',
  'workspaces',
];

describe('openDatabase', () => {
  it('creates every V1 table', () => {
    const db = testDatabase();
    const tables = db.$client
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
      )
      .pluck()
      .all();
    expect(tables).toEqual(V1_TABLES);
  });

  it('turns on WAL, foreign keys and a busy timeout', () => {
    const { $client } = testDatabase();
    expect($client.pragma('journal_mode', { simple: true })).toBe('wal');
    expect($client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect($client.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('can be reopened: migrations already applied are skipped', () => {
    const file = join(tempDir(), 'reopen.db');
    openDatabase(file).$client.close();
    const db = openDatabase(file);
    db.insert(projects).values({ name: 'A', slug: 'a', rootPath: '/a' }).run();
    expect(db.select().from(projects).all()).toHaveLength(1);
    db.$client.close();
  });

  it('throws (and releases the file) when the file is not a database', () => {
    const file = join(tempDir(), 'broken.db');
    writeFileSync(file, 'this is not sqlite'.repeat(100));
    expect(() => openDatabase(file)).toThrow();
  });

  it('fills ids and timestamps', () => {
    const db = testDatabase();
    const before = Date.now();
    const row = db
      .insert(projects)
      .values({ name: 'A', slug: 'a', rootPath: '/a' })
      .returning()
      .get();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.status).toBe('active');
    expect(row.createdAt).toBeGreaterThanOrEqual(before);
    expect(row.updatedAt).toBeGreaterThanOrEqual(row.createdAt);
  });
});

describe('foreign keys', () => {
  /** A project with one of everything hanging off it. */
  function seed() {
    const db = testDatabase();
    const project = db
      .insert(projects)
      .values({ name: 'P', slug: 'p', rootPath: '/p' })
      .returning()
      .get();
    const credential = db
      .insert(credentials)
      .values({
        name: 'key',
        provider: 'x',
        authType: 'api_key',
        encryptedSecret: Buffer.from([1]),
      })
      .returning()
      .get();
    const repository = db
      .insert(repositories)
      .values({ projectId: project.id, localPath: '/p' })
      .returning()
      .get();
    const workspace = db
      .insert(workspaces)
      .values({
        projectId: project.id,
        repositoryId: repository.id,
        name: 'main',
        path: '/p',
        kind: 'main',
      })
      .returning()
      .get();
    db.insert(agents)
      .values({
        projectId: project.id,
        credentialId: credential.id,
        name: 'A',
        adapter: 'claude',
        executable: 'claude',
      })
      .run();
    const globalAgent = db
      .insert(agents)
      .values({ name: 'G', adapter: 'codex', executable: 'codex', credentialId: credential.id })
      .returning()
      .get();
    const agentSession = db
      .insert(agentSessions)
      .values({ agentId: globalAgent.id, workspaceId: workspace.id })
      .returning()
      .get();
    db.insert(terminalSessions)
      .values({
        workspaceId: workspace.id,
        agentSessionId: agentSession.id,
        title: 't',
        shell: 'pwsh',
        cwd: '/p',
        cols: 80,
        rows: 24,
      })
      .run();
    db.insert(auditLogs)
      .values({ projectId: project.id, action: 'x', resourceType: 'project' })
      .run();
    return { db, project, credential, globalAgent };
  }

  it('deleting a project removes everything under it but keeps the audit log', () => {
    const { db, project, globalAgent } = seed();
    db.delete(projects).where(eq(projects.id, project.id)).run();

    expect(db.select().from(repositories).all()).toEqual([]);
    expect(db.select().from(workspaces).all()).toEqual([]);
    expect(db.select().from(agentSessions).all()).toEqual([]);
    expect(db.select().from(terminalSessions).all()).toEqual([]);
    // Only the global agent is left.
    expect(db.select({ id: agents.id }).from(agents).all()).toEqual([{ id: globalAgent.id }]);
    const [log] = db.select().from(auditLogs).all();
    expect(log?.projectId).toBeNull();
  });

  it('deleting a credential unlinks the agents that used it', () => {
    const { db, credential } = seed();
    db.delete(credentials).where(eq(credentials.id, credential.id)).run();
    const rows = db.select({ credentialId: agents.credentialId }).from(agents).all();
    expect(rows).toEqual([{ credentialId: null }, { credentialId: null }]);
  });

  it('rejects rows that point at nothing', () => {
    const db = testDatabase();
    expect(() =>
      db
        .insert(repositories)
        .values({ projectId: '00000000-0000-4000-8000-000000000000', localPath: '/x' })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('enforces unique folders and slugs', () => {
    const db = testDatabase();
    db.insert(projects).values({ name: 'A', slug: 'a', rootPath: '/a' }).run();
    expect(() =>
      db.insert(projects).values({ name: 'B', slug: 'b', rootPath: '/a' }).run(),
    ).toThrow(/UNIQUE/);
    expect(() =>
      db.insert(projects).values({ name: 'C', slug: 'a', rootPath: '/c' }).run(),
    ).toThrow(/UNIQUE/);
  });
});
