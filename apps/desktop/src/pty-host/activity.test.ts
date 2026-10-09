import type { IPty } from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_IDLE_MS,
  ActivityTracker,
  BELL_INTERVAL_MS,
  ECHO_WINDOW_MS,
  type ActivitySignal,
} from './activity';
import { TerminalManager } from './terminals';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function tracker() {
  const signals: ActivitySignal[] = [];
  const activity = new ActivityTracker((signal) => signals.push(signal));
  return { activity, signals };
}

describe('ActivityTracker', () => {
  it('settles after start-up, even with no output', () => {
    const { signals } = tracker();
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS);
    expect(signals).toEqual(['idle']);
  });

  it('treats start-up output as part of start-up', () => {
    const { activity, signals } = tracker();
    activity.output();
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS - 1);
    activity.output();
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS - 1);
    expect(signals).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(signals).toEqual(['idle']);
  });

  it('reports output after a quiet spell once, then idle once it stops', () => {
    const { activity, signals } = tracker();
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS);
    for (let i = 0; i < 10; i++) {
      activity.output();
      vi.advanceTimersByTime(100);
    }
    expect(signals).toEqual(['idle', 'output']);
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS);
    expect(signals).toEqual(['idle', 'output', 'idle']);
  });

  it('ignores the echo of typed input', () => {
    const { activity, signals } = tracker();
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS);
    activity.input();
    vi.advanceTimersByTime(ECHO_WINDOW_MS - 1);
    activity.output();
    expect(signals).toEqual(['idle']);
    // Output well after the keystroke is the agent.
    vi.advanceTimersByTime(ECHO_WINDOW_MS);
    activity.output();
    expect(signals).toEqual(['idle', 'output']);
  });

  it('reports the bell, at most once a second', () => {
    const { activity, signals } = tracker();
    activity.bell();
    activity.bell();
    vi.advanceTimersByTime(BELL_INTERVAL_MS);
    activity.bell();
    expect(signals).toEqual(['bell', 'bell']);
  });

  it('stops when disposed', () => {
    const { activity, signals } = tracker();
    activity.dispose();
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS * 2);
    expect(signals).toEqual([]);
  });
});

describe('TerminalManager activity', () => {
  function fakePty() {
    let dataListener: (data: string) => void = () => {};
    const pty = {
      pid: 1,
      onData: (listener: typeof dataListener) => {
        dataListener = listener;
        return { dispose() {} };
      },
      onExit: () => ({ dispose() {} }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    };
    return { pty: pty as unknown as IPty, data: (data: string) => dataListener(data) };
  }

  const params = (trackActivity: boolean) => ({
    sessionId: 's1',
    file: '/bin/claude',
    args: [],
    cwd: '/tmp',
    env: {},
    cols: 80,
    rows: 24,
    trackActivity,
  });

  it('reports signals for terminals spawned with trackActivity', async () => {
    const fake = fakePty();
    const onActivity = vi.fn();
    const manager = new TerminalManager(() => fake.pty, vi.fn(), onActivity);
    manager.spawn(params(true));
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS);
    expect(onActivity).toHaveBeenLastCalledWith('s1', 'idle');

    // Typed input is echoed: not activity.
    manager.write('s1', 'h');
    fake.data('h');
    expect(onActivity).toHaveBeenCalledTimes(1);

    // Neither is the redraw after a resize (e.g. a UI reload re-fitting the view).
    manager.resize('s1', 100, 30);
    fake.data('redraw');
    expect(onActivity).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ECHO_WINDOW_MS);
    fake.data('Thinking…');
    expect(onActivity).toHaveBeenLastCalledWith('s1', 'output');

    // The bell is found by the screen mirror's parser, so it isn't the BEL ending an OSC.
    fake.data('\x1b]0;title\x07');
    fake.data('\x07');
    await vi.advanceTimersByTimeAsync(10);
    expect(onActivity.mock.calls.filter(([, signal]) => signal === 'bell')).toHaveLength(1);
  });

  it('reports nothing for plain shells', () => {
    const fake = fakePty();
    const onActivity = vi.fn();
    const manager = new TerminalManager(() => fake.pty, vi.fn(), onActivity);
    manager.spawn(params(false));
    fake.data('x\x07');
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS * 2);
    expect(onActivity).not.toHaveBeenCalled();
  });
});
