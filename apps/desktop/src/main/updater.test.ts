import { EventEmitter } from 'node:events';
import type { AppUpdater } from 'electron-updater';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { broadcastEvent } from './ipc';
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, startUpdater, type Updater } from './updater';

vi.mock('./ipc', () => ({ broadcastEvent: vi.fn() }));

/** The parts of electron-updater's AppUpdater the module uses. */
function fakeUpdater() {
  const events = new EventEmitter();
  return Object.assign(events, {
    logger: null as unknown,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => null),
    quitAndInstall: vi.fn(),
  });
}

describe('startUpdater', () => {
  let updater: Updater | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(broadcastEvent).mockClear();
  });
  afterEach(() => {
    updater?.stop();
    vi.useRealTimers();
  });

  it('downloads automatically and installs on quit, checking after start-up and then regularly', () => {
    const fake = fakeUpdater();
    updater = startUpdater(fake as unknown as AppUpdater, vi.fn());
    expect(fake).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true });

    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('says when an update is ready, and restarts into it only then', () => {
    const fake = fakeUpdater();
    const onChange = vi.fn();
    updater = startUpdater(fake as unknown as AppUpdater, onChange);

    updater.restartToUpdate();
    expect(fake.quitAndInstall).not.toHaveBeenCalled();

    fake.emit('update-downloaded', { version: '0.2.0' });
    expect(updater.state()).toEqual({ ready: '0.2.0' });
    expect(onChange).toHaveBeenCalled();
    expect(broadcastEvent).toHaveBeenCalledWith('app:notice', {
      level: 'info',
      message: 'Vcode 0.2.0 is ready and installs when you restart Vcode.',
    });
    updater.restartToUpdate();
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('keeps going quietly when a check fails (offline, no release yet)', async () => {
    const fake = fakeUpdater();
    fake.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));
    updater = startUpdater(fake as unknown as AppUpdater, vi.fn());
    fake.emit('error', new Error('HttpError: 404'));
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(broadcastEvent).not.toHaveBeenCalled();
  });
});
