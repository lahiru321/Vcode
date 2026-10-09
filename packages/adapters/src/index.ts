// CLI agent adapters: Claude Code, Gemini CLI, Codex CLI (custom CLIs in P4-04).

export * from './types';
export { agentInstructions, CliAdapter, parseVersion, VALIDATE_TIMEOUT_MS } from './cli-adapter';
export { ClaudeAdapter } from './claude';
export { CodexAdapter } from './codex';
export { GeminiAdapter } from './gemini';
export { getAdapter, listAdapters } from './registry';
