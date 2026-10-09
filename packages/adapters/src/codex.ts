import { agentInstructions, CliAdapter } from './cli-adapter';
import type { AgentConfig } from './types';

/**
 * Codex CLI (`codex`, npm `@openai/codex`; a `codex.cmd` shim on Windows). It signs in with
 * its own login (ChatGPT account), or uses `OPENAI_API_KEY` from the environment
 * (credentials, P4-05).
 */
export class CodexAdapter extends CliAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex CLI';
  readonly defaultExecutable = 'codex';
  readonly supportsInstructions = true;
  override readonly apiKeyEnv = 'OPENAI_API_KEY';

  protected override launchArgs(config: AgentConfig): string[] {
    const args: string[] = [];
    const model = config.model?.trim();
    if (model) {
      args.push('--model', model);
    }
    const instructions = agentInstructions(config);
    if (instructions) {
      // `-c key=value` overrides one config.toml key; the value is parsed as TOML. A JSON
      // string is a valid TOML basic string, and it has no raw line breaks (see the platform
      // layer: cmd.exe would end the command there).
      args.push('-c', `developer_instructions=${JSON.stringify(instructions)}`);
    }
    return args;
  }
}
