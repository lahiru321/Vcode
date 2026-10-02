import { randomUUID } from 'node:crypto';
import {
  AGENT_ADAPTERS,
  AGENT_STATUSES,
  CREDENTIAL_AUTH_TYPES,
  CREDENTIAL_STATUSES,
  PROJECT_STATUSES,
  SESSION_STATUSES,
  WORKSPACE_KINDS,
  WORKSPACE_STATUSES,
} from '@vcode/shared';
import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// V1 tables, as in the V1 doc §8 ER diagram. IDs are UUID text; timestamps are Unix epoch
// milliseconds. Beyond the diagram: created_at on repositories and workspaces, updated_at on
// agents and credentials, plus unique and foreign-key indexes.
//
// After editing this file run `pnpm db:generate` and commit the new migration.

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());
const createdAt = () =>
  integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now());
const updatedAt = () =>
  integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdateFn(() => Date.now());

export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    rootPath: text('root_path').notNull(),
    defaultBranch: text('default_branch'),
    /** dockview layout, saved per project (P5-05). */
    layoutJson: text('layout_json', { mode: 'json' }).$type<unknown>(),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('projects_slug_unique').on(table.slug),
    uniqueIndex('projects_root_path_unique').on(table.rootPath),
  ],
);

export const repositories = sqliteTable(
  'repositories',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    remoteUrl: text('remote_url'),
    localPath: text('local_path').notNull(),
    defaultBranch: text('default_branch'),
    createdAt: createdAt(),
  },
  (table) => [index('repositories_project_id_idx').on(table.projectId)],
);

export const credentials = sqliteTable(
  'credentials',
  {
    id: id(),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    authType: text('auth_type', { enum: CREDENTIAL_AUTH_TYPES }).notNull(),
    /** Encrypted with Electron safeStorage. Never leaves the main process. */
    encryptedSecret: blob('encrypted_secret', { mode: 'buffer' }).notNull(),
    status: text('status', { enum: CREDENTIAL_STATUSES }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('credentials_name_unique').on(table.name)],
);

export const agents = sqliteTable(
  'agents',
  {
    id: id(),
    /** null = global agent, available in every project. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').references(() => credentials.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    adapter: text('adapter', { enum: AGENT_ADAPTERS }).notNull(),
    /** Command name or absolute path; resolved with platform.resolveExecutable(). */
    executable: text('executable').notNull(),
    argsJson: text('args_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Plain (non-secret) environment variables. Secrets come from credentials. */
    envJson: text('env_json', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    model: text('model'),
    role: text('role'),
    instructions: text('instructions'),
    status: text('status', { enum: AGENT_STATUSES }).notNull().default('unvalidated'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('agents_project_id_idx').on(table.projectId),
    index('agents_credential_id_idx').on(table.credentialId),
  ],
);

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').references(() => repositories.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    /** Real path, always inside the project's root_path (V1 doc §17). */
    path: text('path').notNull(),
    kind: text('kind', { enum: WORKSPACE_KINDS }).notNull(),
    branch: text('branch'),
    status: text('status', { enum: WORKSPACE_STATUSES }).notNull().default('ready'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('workspaces_project_id_name_unique').on(table.projectId, table.name),
    uniqueIndex('workspaces_path_unique').on(table.path),
    index('workspaces_repository_id_idx').on(table.repositoryId),
  ],
);

export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: id(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    status: text('status', { enum: SESSION_STATUSES }).notNull().default('starting'),
    exitCode: integer('exit_code'),
    startedAt: integer('started_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    endedAt: integer('ended_at'),
  },
  (table) => [
    index('agent_sessions_agent_id_idx').on(table.agentId),
    index('agent_sessions_workspace_id_idx').on(table.workspaceId),
  ],
);

export const terminalSessions = sqliteTable(
  'terminal_sessions',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** null = plain shell. */
    agentSessionId: text('agent_session_id').references(() => agentSessions.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    shell: text('shell').notNull(),
    cwd: text('cwd').notNull(),
    pid: integer('pid'),
    cols: integer('cols').notNull(),
    rows: integer('rows').notNull(),
    status: text('status', { enum: SESSION_STATUSES }).notNull().default('starting'),
    exitCode: integer('exit_code'),
    startedAt: integer('started_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    endedAt: integer('ended_at'),
  },
  (table) => [
    index('terminal_sessions_workspace_id_idx').on(table.workspaceId),
    index('terminal_sessions_agent_session_id_idx').on(table.agentSessionId),
  ],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    /** null = app-wide action. Kept (set to null) when the project is deleted. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    metadataJson: text('metadata_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [index('audit_logs_project_id_created_at_idx').on(table.projectId, table.createdAt)],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json', { mode: 'json' }).$type<unknown>().notNull(),
});
