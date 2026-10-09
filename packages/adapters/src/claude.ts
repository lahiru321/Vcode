import { agentInstructions, CliAdapter } from './cli-adapter';
import type { AgentConfig, Environment } from './types';

/**
 * Claude Code (`claude`). Native installs are `claude.exe` / `claude`; npm installs are a
 * `claude.cmd` shim on Windows — both are found by the platform layer. Authentication is
 * Claude Code's own login flow: the app passes no credentials.
 */
export class ClaudeAdapter extends CliAdapter {
  readonly id = 'claude';
  readonly displayName = 'Claude Code';
  readonly defaultExecutable = 'claude';
  readonly supportsInstructions = true;
  override readonly apiKeyEnv = 'ANTHROPIC_API_KEY';

  protected override launchArgs(config: AgentConfig): string[] {
    const args: string[] = [];
    const model = config.model?.trim();
    if (model) {
      args.push('--model', model);
    }
    const prompt = agentInstructions(config);
    if (prompt) {
      args.push('--append-system-prompt', prompt);
    }
    return args;
  }

  override prepareEnvironment(config: AgentConfig, base: Environment): Environment {
    const env = super.prepareEnvironment(config, base);
    // Set inside Claude Code's own terminals; a Claude started with it thinks it is nested.
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    return env;
  }
}
