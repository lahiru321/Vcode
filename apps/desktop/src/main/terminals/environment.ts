import { APP_NAME } from '@vcode/shared';
import { createLogger } from '../logging';
import { platform, toEnvironment, type Environment } from '../platform';

const log = createLogger('terminals');

/**
 * Set by a Claude Code session for its own child processes. When the app itself was started
 * from one (e.g. `pnpm dev` in a Claude Code terminal), they would reach every terminal: a
 * Claude started there would think it is nested (no transcripts) and get the parent session's
 * messaging token. User settings such as CLAUDE_CODE_USE_BEDROCK are not on this list.
 */
const INHERITED_SESSION_VARIABLES = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_PID',
]);

/**
 * The environment for a new terminal, from the user's environment (`base`):
 * - variables a parent Claude Code session sets for its children are removed (see above);
 * - variables Electron sets for the app itself (`ELECTRON_*`) are removed, so a shell or a
 *   Node-based CLI started in the terminal doesn't think it's part of Vcode;
 * - TERM_PROGRAM / COLORTERM are set like other terminal emulators, so CLIs enable colour.
 */
export function prepareTerminalEnvironment(base: Environment, appVersion: string): Environment {
  const env: Environment = {};
  for (const [name, value] of Object.entries(base)) {
    if (!/^ELECTRON_/i.test(name) && !INHERITED_SESSION_VARIABLES.has(name.toUpperCase())) {
      env[name] = value;
    }
  }
  env['TERM_PROGRAM'] = APP_NAME;
  env['TERM_PROGRAM_VERSION'] = appVersion;
  env['COLORTERM'] = 'truecolor';
  return env;
}

let cached: Promise<Environment> | undefined;

/**
 * The user's environment, read once (on Windows this takes ~0.5 s) and reused. If it can't be
 * read, the app's own environment is used instead.
 */
export function loadBaseEnvironment(): Promise<Environment> {
  cached ??= platform.loadUserEnvironment().catch((err: unknown) => {
    log.warn({ err }, "could not read the user's environment; using the app's own");
    return toEnvironment(process.env);
  });
  return cached;
}
