// Best-effort activity of a terminal running an agent (V1 doc §13): whether it is printing or
// has gone quiet, and when it rings the bell. Main turns these signals into READY / WORKING /
// WAITING with the agent's adapter. Only changes are reported, so main hears little.

export type ActivitySignal = 'output' | 'idle' | 'bell';

/** Quiet for this long → `idle`. Agents' spinners redraw several times a second. */
export const ACTIVITY_IDLE_MS = 1500;
/** Output this soon after input is the terminal echoing what was typed, not the agent working. */
export const ECHO_WINDOW_MS = 150;
/** At most one `bell` this often. */
export const BELL_INTERVAL_MS = 1000;

export class ActivityTracker {
  /** Start-up counts as busy: the CLI drawing its first screen. */
  private busy = true;
  private lastInputAt = Number.NEGATIVE_INFINITY;
  private lastBellAt = Number.NEGATIVE_INFINITY;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly emit: (signal: ActivitySignal) => void,
    private readonly now: () => number = Date.now,
  ) {
    // A CLI that prints nothing at start-up still settles.
    this.armIdle();
  }

  /** The user typed or resized: output right after it is a redraw, not the agent working. */
  input(): void {
    this.lastInputAt = this.now();
  }

  output(): void {
    const echo = this.now() - this.lastInputAt < ECHO_WINDOW_MS;
    if (!this.busy) {
      if (echo) {
        return;
      }
      this.busy = true;
      this.emit('output');
    }
    this.armIdle();
  }

  bell(): void {
    const now = this.now();
    if (now - this.lastBellAt >= BELL_INTERVAL_MS) {
      this.lastBellAt = now;
      this.emit('bell');
    }
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
  }

  private armIdle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.busy = false;
      this.emit('idle');
    }, ACTIVITY_IDLE_MS);
  }
}
