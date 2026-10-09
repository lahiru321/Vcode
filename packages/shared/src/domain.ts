// Allowed values for the enum-like columns in the database (V1 doc §8). The SQLite schema and
// the IPC contracts both build on these lists.

export const PROJECT_STATUSES = ['active', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const AGENT_ADAPTERS = ['claude', 'gemini', 'codex', 'custom'] as const;
export type AgentAdapter = (typeof AGENT_ADAPTERS)[number];

/** Result of the last installation/authentication check (`agents:validate`). */
export const AGENT_STATUSES = ['unvalidated', 'ready', 'not_found', 'error'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const CREDENTIAL_AUTH_TYPES = ['api_key', 'env'] as const;
export type CredentialAuthType = (typeof CREDENTIAL_AUTH_TYPES)[number];

/** `unavailable`: the OS keychain can no longer decrypt the secret (e.g. a different user). */
export const CREDENTIAL_STATUSES = ['active', 'unavailable'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const WORKSPACE_KINDS = ['main', 'folder', 'worktree'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const WORKSPACE_STATUSES = ['ready', 'missing', 'error'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

/** Terminal sessions: the process itself. */
export const SESSION_STATUSES = ['starting', 'running', 'exited', 'stopped', 'failed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * Agent sessions (V1 doc §13): CREATED → STARTING → READY → WORKING ⇄ WAITING → STOPPED /
 * FAILED / COMPLETED. READY / WORKING / WAITING are best-effort, from terminal activity.
 * `completed`: the agent exited on its own with code 0.
 */
export const AGENT_SESSION_STATUSES = [
  'created',
  'starting',
  'ready',
  'working',
  'waiting',
  'stopped',
  'failed',
  'completed',
] as const;
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

/** Agent session statuses while its process may still be running. */
export const ACTIVE_AGENT_SESSION_STATUSES = [
  'created',
  'starting',
  'ready',
  'working',
  'waiting',
] as const satisfies readonly AgentSessionStatus[];
