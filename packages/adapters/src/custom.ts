import { CliAdapter } from './cli-adapter';
import type { AdapterContext, AgentConfig, Environment, ValidationResult } from './types';

/**
 * Any command the user enters (V1 doc §12 "custom CLI"): run with the user's arguments and
 * environment, nothing added. There is no default command, and the check only looks the
 * command up: running an unknown program with `--version` could start it for real.
 */
export class CustomCliAdapter extends CliAdapter {
  readonly id = 'custom';
  readonly displayName = 'Custom CLI';
  readonly defaultExecutable = '';
  readonly supportsInstructions = false;
  override readonly supportsModel = false;

  override async validate(
    config: AgentConfig,
    ctx: AdapterContext,
    env: Environment,
  ): Promise<ValidationResult> {
    const executable = await this.resolve(config, ctx, env);
    return executable
      ? { status: 'ready', executable, version: null }
      : { status: 'not_found', message: this.notFoundMessage(config) };
  }

  protected override notFoundMessage(config: AgentConfig): string {
    const command = config.executable.trim();
    return command
      ? `"${command}" was not found. Enter a command on PATH or the full path to a program.`
      : 'Enter the command to run.';
  }
}
