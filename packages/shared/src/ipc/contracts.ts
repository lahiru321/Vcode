import { z } from 'zod';
import {
  AGENT_ADAPTERS,
  AGENT_SESSION_STATUSES,
  AUDIT_ACTIONS,
  AGENT_STATUSES,
  CREDENTIAL_STATUSES,
  PROJECT_STATUSES,
  SESSION_STATUSES,
  WORKSPACE_KINDS,
  WORKSPACE_STATUSES,
} from '../domain';
import { TERMINAL_COLS, TERMINAL_ROWS } from '../terminal-port';
import type { EventChannel, InvokeChannel } from './channels';

// One contract per channel. Main validates every request and response against these, and
// every event payload before sending it. Spec: V1 doc §20 (IPC design).
//
// Response schemas are z.object (strips unknown keys), so fields a service adds by mistake —
// e.g. secrets — never reach the renderer. Request schemas are strict: unknown keys are an error.

const NoPayload = z.undefined();
const Id = z.uuid();
const Timestamp = z.number().int().nonnegative();

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  /** For the renderer's keyboard shortcuts (Cmd on macOS, Ctrl elsewhere) and labels. */
  platform: z.enum(['win32', 'darwin']),
  /** "Explorer" / "Finder", for "Reveal in …". */
  fileManagerName: z.string(),
  versions: z.object({
    electron: z.string(),
    chrome: z.string(),
    node: z.string(),
  }),
});
export type AppInfo = z.infer<typeof AppInfo>;

export const AppNotice = z.object({
  level: z.enum(['info', 'warning', 'error']),
  message: z.string(),
});
export type AppNotice = z.infer<typeof AppNotice>;

/** Something chosen outside the page (the tray menu, a notification) for the renderer to do. */
export const AppCommand = z.discriminatedUnion('command', [
  /** The New terminal dialog for the project on screen. */
  z.object({ command: z.literal('newTerminal') }),
  /** Select the project and bring the terminal's panel to the front. */
  z.object({ command: z.literal('showTerminal'), projectId: Id, terminalId: Id }),
]);
export type AppCommand = z.infer<typeof AppCommand>;

// Projects (V1 doc §20). Deleting a project removes its records, never files on disk.

const ProjectName = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');

export const Project = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  rootPath: z.string(),
  defaultBranch: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Project = z.infer<typeof Project>;

export const ProjectIdRequest = z.strictObject({ id: Id });

export const CreateProjectRequest = z.strictObject({
  /** An existing folder. Main resolves it to its real path. */
  rootPath: z.string().trim().min(1, 'Folder is required').max(4096),
  /** Defaults to the folder name. */
  name: ProjectName.optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z
  .strictObject({
    id: Id,
    name: ProjectName.optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
  })
  .refine((request) => request.name !== undefined || request.status !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

/** Any JSON value. */
export const JsonValue = z.json();
export type JsonValue = z.infer<typeof JsonValue>;

/** Most layouts are a few kB; this leaves room for many panels. */
const MAX_LAYOUT_BYTES = 1_000_000;

/**
 * The project's panel grid (P5-05): dockview's own JSON, which the renderer restores. Main only
 * stores it; null means none.
 */
export const ProjectLayout = z.object({ layout: JsonValue.nullable() });
export type ProjectLayout = z.infer<typeof ProjectLayout>;

export const SaveLayoutRequest = z.strictObject({
  id: Id,
  layout: JsonValue.nullable().refine(
    (layout) => JSON.stringify(layout).length <= MAX_LAYOUT_BYTES,
    'The layout is too large',
  ),
});

// Agents (V1 doc §12, §14, §20): a configured CLI, global (`projectId: null`) or for one project.
// `env` holds plain variables only; an API key is a credential (`credentialId`), whose secret
// never comes back here.

const AgentName = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');
const EnvName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Not a valid variable name');

export const Agent = z.object({
  id: Id,
  projectId: Id.nullable(),
  name: z.string(),
  adapter: z.enum(AGENT_ADAPTERS),
  executable: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  model: z.string().nullable(),
  role: z.string().nullable(),
  instructions: z.string().nullable(),
  /** The API key put in the agent's environment when it starts; null = the CLI's own login. */
  credentialId: Id.nullable(),
  status: z.enum(AGENT_STATUSES),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Agent = z.infer<typeof Agent>;

const OptionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const CreateAgentRequest = z.strictObject({
  /** null or left out = a global agent. */
  projectId: Id.nullable().optional(),
  name: AgentName,
  adapter: z.enum(AGENT_ADAPTERS),
  /** Command name or absolute path; defaults to the adapter's CLI (e.g. "claude"). */
  executable: z.string().trim().max(4096).optional(),
  args: z.array(z.string().max(4096)).max(100).optional(),
  env: z
    .record(EnvName, z.string().max(32_768))
    .refine((env) => Object.keys(env).length <= 100, 'Too many variables')
    .optional(),
  model: OptionalText(200),
  role: OptionalText(200),
  instructions: OptionalText(20_000),
  credentialId: Id.nullable().optional(),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequest>;

/**
 * Only the given fields change; the provider can't. Changes apply to the agent's next start.
 * A new executable resets the status to `unvalidated`.
 */
export const UpdateAgentRequest = CreateAgentRequest.omit({ adapter: true })
  .partial()
  .extend({ id: Id })
  .refine((request) => Object.keys(request).length > 1, { message: 'Nothing to update' });
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequest>;

/** Global agents plus, with `projectId`, that project's own. */
export const ListAgentsRequest = z.strictObject({ projectId: Id.optional() });

export const AgentIdRequest = z.strictObject({ id: Id });

/** The agent with its new `status`; `version` when it was found and ran. */
export const AgentValidation = z.object({
  agent: Agent,
  version: z.string().nullable(),
  message: z.string().nullable(),
});
export type AgentValidation = z.infer<typeof AgentValidation>;

/** A provider the app has an adapter for. The UI builds its provider list from these. */
export const AgentProvider = z.object({
  id: z.enum(AGENT_ADAPTERS),
  displayName: z.string(),
  /** Looked up on PATH when the agent has no executable of its own, e.g. "claude". Empty: the
   * agent must name its executable (custom CLIs). */
  defaultExecutable: z.string(),
  /** Whether the agent's role and instructions reach the CLI. */
  supportsInstructions: z.boolean(),
  /** Whether the agent's model reaches the CLI. */
  supportsModel: z.boolean(),
  /** The variable the CLI reads an API key from, if any: the default for a new key. */
  apiKeyEnv: z.string().nullable(),
});
export type AgentProvider = z.infer<typeof AgentProvider>;

/** Looks for a provider's CLI before an agent is saved (Add Agent dialog). */
export const DetectAgentRequest = z.strictObject({
  adapter: z.enum(AGENT_ADAPTERS),
  /** Command name or absolute path; blank or left out = the provider's default. */
  executable: z.string().trim().max(4096).optional(),
});
export type DetectAgentRequest = z.infer<typeof DetectAgentRequest>;

/** `path` is the file that was found (also for `error`, when it was found but failed). */
export const AgentDetection = z.object({
  status: z.enum(['ready', 'not_found', 'error']),
  path: z.string().nullable(),
  version: z.string().nullable(),
  message: z.string().nullable(),
});
export type AgentDetection = z.infer<typeof AgentDetection>;

// Credentials (V1 doc §16, §20): API keys for CLIs that read one from an environment variable.
// The secret is encrypted in main (safeStorage) and only goes the other way: the renderer can
// set it, never read it. Responses carry metadata only.

export const Credential = z.object({
  id: Id,
  name: z.string(),
  /** The provider it is meant for; the Add / Edit Agent dialog offers it for that provider. */
  provider: z.enum(AGENT_ADAPTERS),
  /** The variable the secret is put in, e.g. ANTHROPIC_API_KEY. */
  envVar: z.string(),
  /** `unavailable`: this computer can no longer decrypt it (e.g. another OS user saved it). */
  status: z.enum(CREDENTIAL_STATUSES),
  /** How many agents use it. */
  agentCount: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Credential = z.infer<typeof Credential>;

/**
 * Creates a credential (no `id`; `secret` required) or changes one (`id`; a new `secret`
 * replaces the old one, none keeps it).
 */
export const SetCredentialRequest = z.strictObject({
  id: Id.optional(),
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  provider: z.enum(AGENT_ADAPTERS),
  envVar: EnvName,
  secret: z
    .string()
    .trim()
    .min(1, 'Enter the key')
    .max(16_384, 'The key is too long')
    .refine((value) => !/[\r\n]/.test(value), 'The key must be on one line')
    .optional(),
});
export type SetCredentialRequest = z.infer<typeof SetCredentialRequest>;

export const CredentialIdRequest = z.strictObject({ id: Id });

// Repositories (V1 doc §8): the Git repository at a project's root. Detected from its `.git`
// files each time it is asked for, so a folder that became a repository later is picked up.

export const Repository = z.object({
  id: Id,
  projectId: Id,
  /** origin's URL (or another remote's), without any user name / token in it. */
  remoteUrl: z.string().nullable(),
  localPath: z.string(),
  /** origin's default branch if known, otherwise the checked-out branch. */
  defaultBranch: z.string().nullable(),
  createdAt: Timestamp,
});
export type Repository = z.infer<typeof Repository>;

export const GetRepositoryRequest = z.strictObject({ projectId: Id });

// Workspaces (V1 doc §17): where a project's terminals run. Every project has a `main` one, its
// root folder. Folder workspaces since P6-03; Git worktrees since P6-04.

export const Workspace = z.object({
  id: Id,
  projectId: Id,
  name: z.string(),
  path: z.string(),
  kind: z.enum(WORKSPACE_KINDS),
  branch: z.string().nullable(),
  status: z.enum(WORKSPACE_STATUSES),
  createdAt: Timestamp,
});
export type Workspace = z.infer<typeof Workspace>;

/** `main` first, then by name. */
export const ListWorkspacesRequest = z.strictObject({ projectId: Id });

const WorkspaceName = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(60, 'Name is too long')
  .refine((name) => /[a-z0-9]/i.test(name), 'Use at least one letter or digit');

/** Git checks the rest (`git check-ref-format --branch`). */
const BranchName = z
  .string()
  .trim()
  .min(1, 'Branch is required')
  .max(200, 'Branch name is too long')
  .refine((name) => !name.startsWith('-'), 'A branch name can’t start with “-”');

export const CreateWorkspaceRequest = z.discriminatedUnion('kind', [
  z.strictObject({
    projectId: Id,
    name: WorkspaceName,
    kind: z.literal('folder'),
    /**
     * An existing folder inside the project (absolute, or relative to its root). Without it a
     * new folder `workspaces/<name>` is made.
     */
    path: z.string().trim().min(1, 'Folder is required').max(4096).optional(),
  }),
  z.strictObject({
    projectId: Id,
    name: WorkspaceName,
    /** A worktree in `workspaces/<name>` with `branch` checked out. */
    kind: z.literal('worktree'),
    /** Checked out as it is if it exists, else created. */
    branch: BranchName,
    /** What a new branch starts from (default: what the main folder has checked out). */
    startPoint: BranchName.optional(),
  }),
]);
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

export const WorkspaceIdRequest = z.strictObject({ id: Id });

export const DeleteWorkspaceRequest = z.strictObject({
  id: Id,
  /** Worktrees: remove even with uncommitted changes (they are lost). */
  force: z.boolean().optional(),
});

export const DeleteWorkspaceResponse = z.object({
  id: Id,
  /** A worktree's folder was removed too; otherwise the folder is still on disk. */
  removedFolder: z.boolean(),
});

/** Uncommitted changes in a workspace (P6-04, P6-06). */
export const WorkspaceChanges = z.object({
  count: z.number().int().nonnegative(),
  /** Up to the first 20, as `git status --porcelain` lines. */
  files: z.array(z.string()),
});
export type WorkspaceChanges = z.infer<typeof WorkspaceChanges>;

// Terminals (V1 doc §11, §20). A terminal runs in a workspace; without `workspaceId` the
// project's `main` workspace (its root folder) is used. Terminal data does not go through
// these channels: each terminal gets its own MessagePort (P2-03). A terminal either runs a
// plain shell or an agent (`agentId` on create; V1 doc §15); `agent` then describes that run.

/** One run of an agent; `status` changes are pushed as `agent:status`. */
export const TerminalAgent = z.object({
  sessionId: Id,
  agentId: Id,
  name: z.string(),
  adapter: z.enum(AGENT_ADAPTERS),
  status: z.enum(AGENT_SESSION_STATUSES),
});
export type TerminalAgent = z.infer<typeof TerminalAgent>;

/** An agent run that is still going, in any project (P5-07: sidebar and status bar). */
export const ActiveAgentSession = z.object({
  sessionId: Id,
  agentId: Id,
  projectId: Id,
  status: z.enum(AGENT_SESSION_STATUSES),
});
export type ActiveAgentSession = z.infer<typeof ActiveAgentSession>;

export const AgentStatusEvent = z.object({
  agentSessionId: Id,
  agentId: Id,
  status: z.enum(AGENT_SESSION_STATUSES),
});
export type AgentStatusEvent = z.infer<typeof AgentStatusEvent>;

export const TerminalSession = z.object({
  id: Id,
  workspaceId: Id,
  agent: TerminalAgent.nullable(),
  title: z.string(),
  shell: z.string(),
  cwd: z.string(),
  pid: z.number().int().nullable(),
  cols: z.number().int(),
  rows: z.number().int(),
  status: z.enum(SESSION_STATUSES),
  exitCode: z.number().int().nullable(),
  startedAt: Timestamp,
  endedAt: Timestamp.nullable(),
});
export type TerminalSession = z.infer<typeof TerminalSession>;

/** Terminal size in character cells. */
export const TerminalCols = z.number().int().min(TERMINAL_COLS.min).max(TERMINAL_COLS.max);
export const TerminalRows = z.number().int().min(TERMINAL_ROWS.min).max(TERMINAL_ROWS.max);

const TerminalTitle = z.string().trim().min(1, 'Enter a title').max(100, 'Title is too long');

export const CreateTerminalRequest = z.strictObject({
  projectId: Id,
  workspaceId: Id.optional(),
  /** Runs this agent (global, or one of the project's) instead of a plain shell. */
  agentId: Id.optional(),
  cols: TerminalCols,
  rows: TerminalRows,
  title: TerminalTitle.optional(),
});
export type CreateTerminalRequest = z.infer<typeof CreateTerminalRequest>;

export const ListTerminalsRequest = z.strictObject({ projectId: Id });

/**
 * Sends the terminal's MessagePort to the calling window on TERMINAL_PORT_CHANNEL, tagged with
 * `attachId` so the page can tell attaches to the same terminal apart.
 */
export const AttachTerminalRequest = z.strictObject({ terminalId: Id, attachId: Id });

export const TerminalIdRequest = z.strictObject({ terminalId: Id });

export const RenameTerminalRequest = z.strictObject({ terminalId: Id, title: TerminalTitle });

// Audit log (P7-05, V1 doc §21): read-only for the renderer.

export const AuditEntry = z.object({
  id: Id,
  /** null: app-wide (e.g. API keys), or the project has since been removed. */
  projectId: Id.nullable(),
  projectName: z.string().nullable(),
  action: z.enum(AUDIT_ACTIONS),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  /** Names, statuses, paths: never secrets. */
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  createdAt: Timestamp,
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const ListAuditRequest = z.strictObject({
  /** Only this project's entries. */
  projectId: Id.optional(),
  /** Entries after this one, in the newest-first order (the next page). */
  after: Id.optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type ListAuditRequest = z.infer<typeof ListAuditRequest>;

/** Bounds of the `maxTerminals` setting. */
export const MAX_TERMINALS = { min: 1, max: 64 } as const;

// Settings the renderer may read and change (V1 doc §20). Each key is one `app_settings` row;
// main falls back to the default when a row is missing or no longer matches its schema.
// Main-only state (e.g. window bounds) lives in the same table but is never exposed here.

export const Settings = z.object({
  /** The project shown in the main area; restored on the next launch. */
  selectedProjectId: Id.nullable(),
  /** Closing the window hides it to the tray; agents keep running (P7-02). */
  closeToTray: z.boolean(),
  /** Notify when an agent finishes, fails, or waits for input while the app is in the background (P7-03). */
  notifications: z.boolean(),
  /** Terminals (shells and agents) running at once, across all projects (P7-07). */
  maxTerminals: z.number().int().min(MAX_TERMINALS.min).max(MAX_TERMINALS.max),
});
export type Settings = z.infer<typeof Settings>;
export type SettingKey = keyof Settings;

export const SETTING_DEFAULTS: Settings = {
  selectedProjectId: null,
  closeToTray: true,
  notifications: true,
  maxTerminals: 16,
};

/** Only the given keys are changed. */
export const SetSettingsRequest = z
  .strictObject(Settings.shape)
  .partial()
  .refine((request) => Object.keys(request).length > 0, { message: 'Nothing to update' });

/** A whole scrollback (5000 lines) of wide lines fits. */
export const WriteClipboardRequest = z.strictObject({ text: z.string().max(4_000_000) });

/** `path` is null when the user cancels the dialog. */
export const PickFolderResponse = z.object({ path: z.string().nullable() });

export const invokeContracts = {
  'app:getInfo': { request: NoPayload, response: AppInfo },
  'projects:list': { request: NoPayload, response: z.array(Project) },
  'projects:get': { request: ProjectIdRequest, response: Project },
  'projects:create': { request: CreateProjectRequest, response: Project },
  'projects:update': { request: UpdateProjectRequest, response: Project },
  'projects:delete': { request: ProjectIdRequest, response: z.object({ id: Id }) },
  'projects:getLayout': { request: ProjectIdRequest, response: ProjectLayout },
  'projects:saveLayout': { request: SaveLayoutRequest, response: z.null() },
  'agents:list': { request: ListAgentsRequest, response: z.array(Agent) },
  'agents:create': { request: CreateAgentRequest, response: Agent },
  /** Runs the CLI's version check and records the result as the agent's status. */
  'agents:validate': { request: AgentIdRequest, response: AgentValidation },
  'agents:update': { request: UpdateAgentRequest, response: Agent },
  /** CONFLICT while the agent is running. Its ended sessions go with it. */
  'agents:delete': { request: AgentIdRequest, response: z.object({ id: Id }) },
  'agents:providers': { request: NoPayload, response: z.array(AgentProvider) },
  /** Runs a provider's version check without saving anything. */
  'agents:detect': { request: DetectAgentRequest, response: AgentDetection },
  /** Every agent run still going, oldest first; `agent:status` events keep it current. */
  'agents:sessions': { request: NoPayload, response: z.array(ActiveAgentSession) },
  /** Metadata only: secrets never leave main. */
  'credentials:list': { request: NoPayload, response: z.array(Credential) },
  /** CONFLICT if the name is taken; UNAVAILABLE if this computer can't encrypt. */
  'credentials:set': { request: SetCredentialRequest, response: Credential },
  /** Agents that used it go back to the CLI's own login. */
  'credentials:delete': { request: CredentialIdRequest, response: z.object({ id: Id }) },
  /**
   * Detects the project's repository again and updates the project's default branch to match;
   * null if its folder isn't a Git repository root.
   */
  'repositories:get': { request: GetRepositoryRequest, response: Repository.nullable() },
  /** Each folder is checked on the way: `status` is `missing` / `error` if it can't be used. */
  'workspaces:list': { request: ListWorkspacesRequest, response: z.array(Workspace) },
  /**
   * CONFLICT if the name or folder is taken (or git refuses the worktree); INVALID_REQUEST for a
   * folder outside the project; UNAVAILABLE for a worktree without git installed.
   */
  'workspaces:create': { request: CreateWorkspaceRequest, response: Workspace },
  /**
   * Removes the record. A folder workspace's files stay; a worktree is removed with
   * `git worktree remove` (its branch stays). CONFLICT for `main`, while a terminal runs in it,
   * and for a worktree with uncommitted changes unless `force`.
   */
  'workspaces:delete': { request: DeleteWorkspaceRequest, response: DeleteWorkspaceResponse },
  /**
   * A worktree's own changes; `main`: the project folder's; a folder workspace: those inside it.
   * Null if the folder is missing or not in a Git repository. UNAVAILABLE without git.
   */
  'workspaces:changes': { request: WorkspaceIdRequest, response: WorkspaceChanges.nullable() },
  /** Shows the workspace folder in Explorer / Finder. INVALID_REQUEST if it fails the path guards. */
  'workspaces:reveal': { request: WorkspaceIdRequest, response: z.null() },
  /** Opens the workspace folder in VS Code. UNAVAILABLE if VS Code isn't installed. */
  'workspaces:openInEditor': { request: WorkspaceIdRequest, response: z.null() },
  'terminals:list': { request: ListTerminalsRequest, response: z.array(TerminalSession) },
  'terminals:create': { request: CreateTerminalRequest, response: TerminalSession },
  'terminals:attach': {
    request: AttachTerminalRequest,
    response: z.object({ terminalId: Id }),
  },
  /** Ends the terminal's whole process tree; the row is returned as `stopped`. */
  'terminals:stop': { request: TerminalIdRequest, response: TerminalSession },
  /** Stops the terminal if it is running and starts a new one in its place (a new id). */
  'terminals:restart': { request: TerminalIdRequest, response: TerminalSession },
  /** Stops the terminal if it is running; the UI then removes it. */
  'terminals:close': { request: TerminalIdRequest, response: z.object({ terminalId: Id }) },
  /** The title shown on the terminal's tab; kept when it restarts. */
  'terminals:rename': { request: RenameTerminalRequest, response: TerminalSession },
  /** Newest first. */
  'audit:list': {
    request: ListAuditRequest,
    response: z.object({ entries: z.array(AuditEntry), hasMore: z.boolean() }),
  },
  'settings:get': { request: NoPayload, response: Settings },
  'settings:set': { request: SetSettingsRequest, response: Settings },
  'dialog:pickFolder': { request: NoPayload, response: PickFolderResponse },
  /** Puts text (a terminal's selection) on the clipboard. */
  'clipboard:writeText': { request: WriteClipboardRequest, response: z.null() },
  /**
   * Edit → Paste on the calling window: the focused terminal gets a paste event. The page can't
   * read the clipboard any other way.
   */
  'clipboard:paste': { request: NoPayload, response: z.null() },
} satisfies Record<InvokeChannel, { request: z.ZodType; response: z.ZodType }>;

export const eventContracts = {
  'app:notice': AppNotice,
  'app:command': AppCommand,
  'agent:status': AgentStatusEvent,
} satisfies Record<EventChannel, z.ZodType>;

export type InvokeRequest<C extends InvokeChannel> = z.input<
  (typeof invokeContracts)[C]['request']
>;
export type InvokeResponse<C extends InvokeChannel> = z.output<
  (typeof invokeContracts)[C]['response']
>;
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContracts)[C]>;

/** Arguments after the channel name: none for channels without a payload. */
export type InvokeArgs<C extends InvokeChannel> =
  InvokeRequest<C> extends undefined ? [] : [request: InvokeRequest<C>];
