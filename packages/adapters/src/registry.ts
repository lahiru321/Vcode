import { ClaudeAdapter } from './claude';
import type { AgentAdapter } from './types';

// Adapters by `agents.adapter` value. Gemini, Codex and custom CLIs come in P4.
const adapters = new Map<string, AgentAdapter>([['claude', new ClaudeAdapter()]]);

/** The adapter for an `agents.adapter` value, or null if there is none yet. */
export function getAdapter(id: string): AgentAdapter | null {
  return adapters.get(id) ?? null;
}
