import { app } from 'electron';
import { getDatabase } from '../db';
import { createLogger } from '../logging';
import { platform } from '../platform';
import { ptyHost } from '../pty-host';
import { loadBaseEnvironment, prepareTerminalEnvironment } from './environment';
import {
  endActiveSessions,
  failStaleSessions,
  recordTerminalExit,
  type TerminalDeps,
} from './service';

export { attachTerminal, createTerminal, listTerminals } from './service';

const log = createLogger('terminals');

/** The real dependencies of the terminal service. */
export function terminalDeps(): TerminalDeps {
  return {
    db: getDatabase(),
    host: ptyHost,
    environment: async () =>
      prepareTerminalEnvironment(await loadBaseEnvironment(), app.getVersion()),
    resolveShell: async (env) => {
      const shell = await platform.defaultShell(env);
      const command = platform.buildCommand(
        { path: shell, kind: 'binary' },
        platform.shellArgs(shell),
        env,
      );
      return { shell, command };
    },
  };
}

/** Keeps terminal_sessions in step with the PTY host. Call before `ptyHost.start()`. */
export function trackTerminalSessions(): void {
  const stale = failStaleSessions(getDatabase());
  if (stale > 0) {
    log.warn({ count: stale }, 'marked terminals from an earlier run as failed');
  }
  ptyHost.on('terminalExit', (exit) =>
    // While the host shuts down, it is the one closing the terminals.
    recordTerminalExit(getDatabase(), exit, ptyHost.state === 'stopping' ? 'stopped' : 'exited'),
  );
  ptyHost.on('exit', ({ expected }) => {
    const pids = endActiveSessions(getDatabase(), expected ? 'stopped' : 'failed');
    // A crashed host leaves its shells running; so can a slow shutdown.
    for (const pid of pids) {
      platform.killProcessTree(pid).catch((err: unknown) => {
        log.warn({ err, pid }, 'could not end a terminal left behind by the PTY host');
      });
    }
    if (pids.length > 0) {
      log.warn({ pids, expected }, 'ended terminals left behind by the PTY host');
    }
  });
  // Read the user's environment now, so the first terminal doesn't wait for it.
  void loadBaseEnvironment();
}
