import { APP_NAME } from '@vcode/shared';
import { createLogger } from '../logging';
import { platform, toEnvironment, type Environment } from '../platform';

const log = createLogger('terminals');

/**
 * The environment for a new terminal, from the user's environment (`base`):
 * - variables Electron sets for the app itself (`ELECTRON_*`) are removed, so a shell or a
 *   Node-based CLI started in the terminal doesn't think it's part of Vcode;
 * - TERM_PROGRAM / COLORTERM are set like other terminal emulators, so CLIs enable colour.
 */
export function prepareTerminalEnvironment(base: Environment, appVersion: string): Environment {
  const env: Environment = {};
  for (const [name, value] of Object.entries(base)) {
    if (!/^ELECTRON_/i.test(name)) {
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
