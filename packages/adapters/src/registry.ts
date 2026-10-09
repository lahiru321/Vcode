import { ClaudeAdapter } from './claude';
import { CodexAdapter } from './codex';
import { CustomCliAdapter } from './custom';
import { GeminiAdapter } from './gemini';
import type { AgentAdapter } from './types';

// Adapters by `agents.adapter` value, in the order the UI lists them.
const adapters = new Map<string, AgentAdapter>(
  [new ClaudeAdapter(), new GeminiAdapter(), new CodexAdapter(), new CustomCliAdapter()].map(
    (a) => [a.id, a],
  ),
);

/** The adapter for an `agents.adapter` value, or null if there is none yet. */
export function getAdapter(id: string): AgentAdapter | null {
  return adapters.get(id) ?? null;
}

/** Every adapter, in registration order. */
export function listAdapters(): AgentAdapter[] {
  return [...adapters.values()];
}
