import { EventEmitter } from 'node:events';
import type { AppUpdater } from 'electron-updater';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { broadcastEvent } from './ipc/registry';
import {
  activeUpdater,
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  startUpdater,
  type Updater,
  type UpdaterHooks,
} from './updater';

vi.mock('./ipc/registry', () => ({ broadcastEvent: vi.fn() }));

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

function hooks(agree = true) {
  return {
    onChange: vi.fn(),
    confirmQuit: vi.fn(async () => agree),
    quitNow: vi.fn(),
  } satisfies UpdaterHooks;
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
    updater = startUpdater(fake as unknown as AppUpdater, hooks());
    expect(fake).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true });

    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('tells the window when an update is ready, and restarts into it only then', async () => {
    const fake = fakeUpdater();
    const h = hooks();
    updater = startUpdater(fake as unknown as AppUpdater, h);
    expect(activeUpdater()).toBe(updater);

    await updater.restartToUpdate();
    expect(h.confirmQuit).not.toHaveBeenCalled();
    expect(fake.quitAndInstall).not.toHaveBeenCalled();

    fake.emit('update-downloaded', { version: '0.2.0' });
    expect(updater.state()).toEqual({ ready: '0.2.0' });
    expect(h.onChange).toHaveBeenCalled();
    expect(broadcastEvent).toHaveBeenCalledWith('app:update', { ready: '0.2.0' });

    await updater.restartToUpdate();
    expect(h.quitNow).toHaveBeenCalled();
    // Silent, and the new version starts afterwards.
    expect(fake.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
  });

  it('does not start the installer when the user keeps running agents', async () => {
    const fake = fakeUpdater();
    const h = hooks(false);
    updater = startUpdater(fake as unknown as AppUpdater, h);
    fake.emit('update-downloaded', { version: '0.2.0' });

    await updater.restartToUpdate();
    expect(h.confirmQuit).toHaveBeenCalledTimes(1);
    expect(h.quitNow).not.toHaveBeenCalled();
    expect(fake.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps going quietly when a check fails (offline, no release yet)', async () => {
    const fake = fakeUpdater();
    fake.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));
    updater = startUpdater(fake as unknown as AppUpdater, hooks());
    fake.emit('error', new Error('HttpError: 404'));
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(broadcastEvent).not.toHaveBeenCalled();
  });

  it('is no longer the active updater once stopped', () => {
    updater = startUpdater(fakeUpdater() as unknown as AppUpdater, hooks());
    updater.stop();
    expect(activeUpdater()).toBeNull();
  });
});
