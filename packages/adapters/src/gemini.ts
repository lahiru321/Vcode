import { CliAdapter } from './cli-adapter';
import type { AgentConfig } from './types';

/**
 * Gemini CLI (`gemini`, npm `@google/gemini-cli`; a `gemini.cmd` shim on Windows). It signs
 * in with its own login, or uses `GEMINI_API_KEY` from the environment (credentials, P4-05).
 *
 * It has no way to add instructions at start: `GEMINI_SYSTEM_MD` replaces the whole built-in
 * system prompt (tool rules included), and `--prompt-interactive` would send them as a first
 * message. Project instructions belong in the project's `GEMINI.md`, so role and instructions
 * are not supported.
 */
export class GeminiAdapter extends CliAdapter {
  readonly id = 'gemini';
  readonly displayName = 'Gemini CLI';
  readonly defaultExecutable = 'gemini';
  readonly supportsInstructions = false;
  override readonly apiKeyEnv = 'GEMINI_API_KEY';

  protected override launchArgs(config: AgentConfig): string[] {
    const model = config.model?.trim();
    return model ? ['--model', model] : [];
  }
}
