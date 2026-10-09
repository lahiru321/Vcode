import { app } from 'electron';
import { adapterContext } from '../agents/run';
import { agentSessionEvents } from '../agents/sessions';
import { getDatabase } from '../db';
import { broadcastEvent } from '../ipc/registry';
import { createLogger } from '../logging';
import { platform } from '../platform';
import { ptyHost } from '../pty-host';
import { loadBaseEnvironment, prepareTerminalEnvironment } from './environment';
import { killLeftovers } from './orphans';
import {
  endActiveSessions,
  failStaleSessions,
  recordTerminalActivity,
  recordTerminalExit,
  type TerminalDeps,
} from './service';

export {
  attachTerminal,
  closeTerminal,
  createTerminal,
  listTerminals,
  restartTerminal,
  stopTerminal,
  withAgents,
} from './service';

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
    killProcessTree: (pid) => platform.killProcessTree(pid),
    adapters: adapterContext,
  };
}

/** Keeps terminal_sessions in step with the PTY host. Call before `ptyHost.start()`. */
export function trackTerminalSessions(): void {
  // Sessions an earlier run left "running" (it crashed): mark them now, before the UI lists
  // terminals, then end any of their processes that are still around (V1 doc §11).
  const stale = failStaleSessions(getDatabase());
  if (stale.length > 0) {
    log.warn({ count: stale.length }, 'marked terminals from an earlier run as failed');
    killLeftovers(stale, platform, (err, pid) => {
      log.warn({ err, pid }, 'could not end a process left behind by an earlier run');
    }).then(
      (pids) => {
        if (pids.length > 0) {
          log.warn({ pids }, 'ended processes left behind by an earlier run');
        }
      },
      (err: unknown) => log.warn({ err }, 'could not check for processes left behind'),
    );
  }
  ptyHost.on('terminalExit', (exit) =>
    // While the host shuts down, it is the one closing the terminals.
    recordTerminalExit(getDatabase(), exit, ptyHost.state === 'stopping' ? 'stopped' : 'exited'),
  );
  ptyHost.on('terminalActivity', (activity) => recordTerminalActivity(getDatabase(), activity));
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
  agentSessionEvents.on('status', (update) => broadcastEvent('agent:status', update));
  // Read the user's environment now, so the first terminal doesn't wait for it.
  void loadBaseEnvironment();
}
