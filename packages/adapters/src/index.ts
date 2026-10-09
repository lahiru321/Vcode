// CLI agent adapters: Claude Code, Gemini CLI, Codex CLI and any custom command.

export * from './types';
export { agentInstructions, CliAdapter, parseVersion, VALIDATE_TIMEOUT_MS } from './cli-adapter';
export { ClaudeAdapter } from './claude';
export { CodexAdapter } from './codex';
export { CustomCliAdapter } from './custom';
export { GeminiAdapter } from './gemini';
export { getAdapter, listAdapters } from './registry';
