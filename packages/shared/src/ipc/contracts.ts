import { z } from 'zod';
import { AGENT_ADAPTERS, AGENT_STATUSES, PROJECT_STATUSES, SESSION_STATUSES } from '../domain';
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

// Agents (V1 doc §12, §14, §20): a configured CLI, global (`projectId: null`) or for one project.
// `env` holds plain variables only; secrets are credentials (P4) and never come back here.

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
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequest>;

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

// Terminals (V1 doc §11, §20). A terminal runs in a workspace; without `workspaceId` the
// project's `main` workspace (its root folder) is used. Terminal data does not go through
// these channels: each terminal gets its own MessagePort (P2-03).

export const TerminalSession = z.object({
  id: Id,
  workspaceId: Id,
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

export const CreateTerminalRequest = z.strictObject({
  projectId: Id,
  workspaceId: Id.optional(),
  cols: TerminalCols,
  rows: TerminalRows,
  title: z.string().trim().min(1).max(100).optional(),
});
export type CreateTerminalRequest = z.infer<typeof CreateTerminalRequest>;

export const ListTerminalsRequest = z.strictObject({ projectId: Id });

/**
 * Sends the terminal's MessagePort to the calling window on TERMINAL_PORT_CHANNEL, tagged with
 * `attachId` so the page can tell attaches to the same terminal apart.
 */
export const AttachTerminalRequest = z.strictObject({ terminalId: Id, attachId: Id });

export const TerminalIdRequest = z.strictObject({ terminalId: Id });

// Settings the renderer may read and change (V1 doc §20). Each key is one `app_settings` row;
// main falls back to the default when a row is missing or no longer matches its schema.
// Main-only state (e.g. window bounds) lives in the same table but is never exposed here.

export const Settings = z.object({
  /** The project shown in the main area; restored on the next launch. */
  selectedProjectId: Id.nullable(),
});
export type Settings = z.infer<typeof Settings>;
export type SettingKey = keyof Settings;

export const SETTING_DEFAULTS: Settings = {
  selectedProjectId: null,
};

/** Only the given keys are changed. */
export const SetSettingsRequest = z
  .strictObject(Settings.shape)
  .partial()
  .refine((request) => Object.keys(request).length > 0, { message: 'Nothing to update' });

/** `path` is null when the user cancels the dialog. */
export const PickFolderResponse = z.object({ path: z.string().nullable() });

export const invokeContracts = {
  'app:getInfo': { request: NoPayload, response: AppInfo },
  'projects:list': { request: NoPayload, response: z.array(Project) },
  'projects:get': { request: ProjectIdRequest, response: Project },
  'projects:create': { request: CreateProjectRequest, response: Project },
  'projects:update': { request: UpdateProjectRequest, response: Project },
  'projects:delete': { request: ProjectIdRequest, response: z.object({ id: Id }) },
  'agents:list': { request: ListAgentsRequest, response: z.array(Agent) },
  'agents:create': { request: CreateAgentRequest, response: Agent },
  /** Runs the CLI's version check and records the result as the agent's status. */
  'agents:validate': { request: AgentIdRequest, response: AgentValidation },
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
  'settings:get': { request: NoPayload, response: Settings },
  'settings:set': { request: SetSettingsRequest, response: Settings },
  'dialog:pickFolder': { request: NoPayload, response: PickFolderResponse },
} satisfies Record<InvokeChannel, { request: z.ZodType; response: z.ZodType }>;

export const eventContracts = {
  'app:notice': AppNotice,
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
