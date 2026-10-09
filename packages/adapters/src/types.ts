// Types shared by every CLI agent adapter (V1 doc §12). Adapters never touch the OS directly:
// they get the platform layer and a process runner from the main process (`AdapterContext`),
// so this package stays free of Node and Electron imports and is easy to test.

/** Environment variables for a child process. Values are never undefined. */
export type Environment = Record<string, string>;

/** Same shapes as the main process's platform layer (`src/main/platform/types.ts`). */
export interface Executable {
  /** Absolute path of the file that was found. */
  path: string;
  kind: 'binary' | 'batch' | 'powershell';
}

export interface Command {
  file: string;
  args: string[];
  /** Windows only: `args` are already quoted for cmd.exe and must not be quoted again. */
  verbatimArguments: boolean;
}

/** The parts of the platform layer an adapter may use. */
export interface AdapterPlatform {
  resolveExecutable(command: string, env: Environment): Promise<Executable | null>;
  buildCommand(executable: Executable, args: string[], env: Environment): Command;
}

export interface RunResult {
  /** null when the process was killed (timeout) or never started. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs a command to completion without a terminal, e.g. `claude --version`. Never throws. */
export type RunCommand = (
  command: Command,
  options: { env: Environment; timeoutMs: number },
) => Promise<RunResult>;

export interface AdapterContext {
  platform: AdapterPlatform;
  run: RunCommand;
}

/** An agent as configured by the user (the `agents` table, minus bookkeeping). */
export interface AgentConfig {
  name: string;
  /** Command name ("claude") or absolute path. */
  executable: string;
  /** Extra arguments, passed after the ones the adapter adds. */
  args: string[];
  /** Plain (non-secret) environment variables. */
  env: Environment;
  model: string | null;
  role: string | null;
  instructions: string | null;
}

export type ValidationResult =
  | { status: 'ready'; executable: Executable; version: string | null }
  | { status: 'not_found'; message: string }
  | { status: 'error'; message: string; executable?: Executable };

/** Everything the PTY host needs to start the agent. */
export interface LaunchCommand extends Command {
  env: Environment;
  cwd: string;
}

/** A running agent session, as the adapter sees it. */
export interface AgentSessionHandle {
  readonly sessionId: string;
  readonly pid: number;
  /** Types into the agent's terminal. */
  write(data: string): void;
  /** Ends the agent and every process it started. */
  killTree(): Promise<void>;
}

/** Best-effort agent states, detected from terminal activity (V1 doc §13). */
export type AgentActivity = 'ready' | 'working' | 'waiting';

/**
 * What the terminal did, as seen by the PTY host:
 * - `output`: the agent started printing (not just echoing what the user typed).
 * - `idle`: no output for a while.
 * - `bell`: the agent rang the terminal bell.
 */
export type TerminalSignal = 'output' | 'idle' | 'bell';

/**
 * One CLI agent provider (V1 doc §12). The main process owns processes and terminals; an
 * adapter only decides what to run and how to read the agent's activity.
 */
export interface AgentAdapter {
  readonly id: string;
  /** For UI labels, e.g. "Claude Code". */
  readonly displayName: string;
  /** The command looked up on PATH when the user doesn't give a path, e.g. "claude". */
  readonly defaultExecutable: string;
  /** Whether the agent's role and instructions reach the CLI (the UI says when they don't). */
  readonly supportsInstructions: boolean;

  /** Checks the CLI is installed and runs (e.g. its version command). */
  validate(config: AgentConfig, ctx: AdapterContext, env: Environment): Promise<ValidationResult>;
  /** The agent's environment: `base` (the user's environment) plus the agent's own variables. */
  prepareEnvironment(config: AgentConfig, base: Environment): Environment;
  /** What to spawn. Throws `AdapterError` if the executable can't be found. */
  buildCommand(
    config: AgentConfig,
    ctx: AdapterContext,
    options: { env: Environment; cwd: string },
  ): Promise<LaunchCommand>;
  /** Called once the agent's process is running. */
  start(session: AgentSessionHandle): Promise<void>;
  /** Stops the agent; by default ends its process tree. */
  stop(session: AgentSessionHandle): Promise<void>;
  /** The agent's state after `signal`, or null to keep `current`. */
  getStatus(current: AgentActivity | 'starting', signal: TerminalSignal): AgentActivity | null;
  /** Called once the agent's process has ended, however it ended. */
  cleanup(session: Pick<AgentSessionHandle, 'sessionId'>): Promise<void>;
}

export class AdapterError extends Error {
  constructor(
    readonly reason: 'not_found' | 'invalid_config',
    message: string,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}
