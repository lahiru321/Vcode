import {
  AdapterError,
  type AdapterContext,
  type AgentActivity,
  type AgentAdapter,
  type AgentConfig,
  type AgentSessionHandle,
  type Environment,
  type Executable,
  type LaunchCommand,
  type TerminalSignal,
  type ValidationResult,
} from './types';

/** How long a version check may take. npm shims on a cold disk can take a few seconds. */
export const VALIDATE_TIMEOUT_MS = 15_000;

/** "claude 2.1.3 (Claude Code)" → "2.1.3". */
export function parseVersion(output: string): string | null {
  return /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/.exec(output)?.[0] ?? null;
}

/** The agent's role and instructions as one text, for CLIs that take extra instructions. */
export function agentInstructions(config: AgentConfig): string | null {
  const parts: string[] = [];
  const role = config.role?.trim();
  if (role) {
    parts.push(`Your role: ${role}`);
  }
  const instructions = config.instructions?.trim();
  if (instructions) {
    parts.push(instructions);
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * The common shape of an interactive coding CLI: found on PATH (or by path), checked with a
 * version flag, started with arguments. Providers override `launchArgs` and, where needed,
 * `prepareEnvironment` or the activity rules.
 */
export abstract class CliAdapter implements AgentAdapter {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly defaultExecutable: string;
  abstract readonly supportsInstructions: boolean;
  readonly supportsModel: boolean = true;
  readonly apiKeyEnv: string | null = null;
  /** Arguments that print the version and exit. */
  protected readonly versionArgs: string[] = ['--version'];

  /** Arguments the adapter adds from the config (model, instructions…), before `config.args`. */
  protected launchArgs(_config: AgentConfig): string[] {
    return [];
  }

  protected async resolve(
    config: AgentConfig,
    ctx: AdapterContext,
    env: Environment,
  ): Promise<Executable | null> {
    const command = config.executable.trim() || this.defaultExecutable;
    return command ? ctx.platform.resolveExecutable(command, env) : null;
  }

  protected notFoundMessage(config: AgentConfig): string {
    const command = config.executable.trim() || this.defaultExecutable;
    return `${this.displayName} was not found ("${command}"). Install it, or set the path to its executable.`;
  }

  async validate(
    config: AgentConfig,
    ctx: AdapterContext,
    env: Environment,
  ): Promise<ValidationResult> {
    const executable = await this.resolve(config, ctx, env);
    if (!executable) {
      return { status: 'not_found', message: this.notFoundMessage(config) };
    }
    const command = ctx.platform.buildCommand(executable, this.versionArgs, env);
    const result = await ctx.run(command, { env, timeoutMs: VALIDATE_TIMEOUT_MS });
    if (result.timedOut) {
      return {
        status: 'error',
        executable,
        message: `${this.displayName} did not answer "${this.versionArgs.join(' ')}" in time.`,
      };
    }
    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).trim().split(/\r?\n/)[0];
      return {
        status: 'error',
        executable,
        message: `${this.displayName} failed to start (exit code ${result.exitCode ?? 'none'})${detail ? `: ${detail}` : '.'}`,
      };
    }
    return { status: 'ready', executable, version: parseVersion(result.stdout) };
  }

  prepareEnvironment(config: AgentConfig, base: Environment): Environment {
    return { ...base, ...config.env };
  }

  async buildCommand(
    config: AgentConfig,
    ctx: AdapterContext,
    options: { env: Environment; cwd: string },
  ): Promise<LaunchCommand> {
    const executable = await this.resolve(config, ctx, options.env);
    if (!executable) {
      throw new AdapterError('not_found', this.notFoundMessage(config));
    }
    const args = [...this.launchArgs(config), ...config.args];
    const command = ctx.platform.buildCommand(executable, args, options.env);
    return { ...command, env: options.env, cwd: options.cwd };
  }

  async start(_session: AgentSessionHandle): Promise<void> {}

  async stop(session: AgentSessionHandle): Promise<void> {
    await session.killTree();
  }

  /**
   * Default rules: the start-up screen settles → `ready`; the agent prints → `working`; it
   * goes quiet or rings the bell after working → `waiting` (for the user).
   */
  getStatus(current: AgentActivity | 'starting', signal: TerminalSignal): AgentActivity | null {
    if (current === 'starting') {
      // Start-up output is the CLI drawing its screen, not work.
      return signal === 'output' ? null : 'ready';
    }
    switch (signal) {
      case 'output':
        return current === 'working' ? null : 'working';
      case 'idle':
        return current === 'working' ? 'waiting' : null;
      case 'bell':
        return current === 'waiting' ? null : 'waiting';
    }
  }

  async cleanup(_session: Pick<AgentSessionHandle, 'sessionId'>): Promise<void> {}
}
