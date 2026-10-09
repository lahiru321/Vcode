// CLI agent adapters (Claude Code now; Gemini CLI, Codex CLI and custom CLIs in P4).

export * from './types';
export { CliAdapter, parseVersion, VALIDATE_TIMEOUT_MS } from './cli-adapter';
export { ClaudeAdapter } from './claude';
export { getAdapter } from './registry';
