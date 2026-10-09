import { basename } from 'node:path';
import type { Platform, ProcessInfo } from '../platform';
import type { StaleSession } from './service';

// Orphan cleanup (V1 doc §11 "Orphan cleanup"): after a crash, a terminal's process can outlive
// the app. On the next launch every session still recorded as running is checked, and its
// process is ended only if it is still the one we started: same PID *and* same executable name
// and start time, so an unrelated process that later got the same PID is never touched.

/** How far the process start may be from the session's `startedAt` (recorded just before spawn). */
const START_TOLERANCE_BEFORE_MS = 2_000; // clock granularity; macOS reports whole seconds
const START_TOLERANCE_AFTER_MS = 60_000; // a slow spawn

/** "C:\…\PWSH.EXE" and "pwsh.exe" match; so do "/bin/zsh" and "-zsh". */
function executableName(path: string): string {
  return basename(path.replace(/\\/g, '/')).replace(/^-/, '').toLowerCase();
}

/** Whether `process` is the one this session started. */
export function isSessionProcess(session: StaleSession, process: ProcessInfo): boolean {
  return (
    executableName(session.shell) === executableName(process.name) &&
    process.startedAt >= session.startedAt - START_TOLERANCE_BEFORE_MS &&
    process.startedAt <= session.startedAt + START_TOLERANCE_AFTER_MS
  );
}

/** Ends the processes left behind by `sessions`. Returns the PIDs whose trees were ended. */
export async function killLeftovers(
  sessions: StaleSession[],
  platform: Pick<Platform, 'processInfo' | 'killProcessTree'>,
  onError: (error: unknown, pid: number) => void,
): Promise<number[]> {
  const withPid = sessions.filter((s): s is StaleSession & { pid: number } => s.pid !== null);
  if (withPid.length === 0) {
    return [];
  }
  const running = await platform.processInfo(withPid.map((s) => s.pid));
  const killed: number[] = [];
  for (const session of withPid) {
    const process = running.get(session.pid);
    if (!process || !isSessionProcess(session, process)) {
      continue;
    }
    try {
      await platform.killProcessTree(session.pid);
      killed.push(session.pid);
    } catch (error) {
      onError(error, session.pid);
    }
  }
  return killed;
}
