import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainToHost } from '../../pty-host/protocol';
import { PtyHostError, PtyHostSupervisor, type HostProcess } from './supervisor';

/** Stands in for Electron's UtilityProcess. Tests drive it with `send()` and `exit()`. */
class FakeHost extends EventEmitter implements HostProcess {
  static nextPid = 100;
  readonly pid = FakeHost.nextPid++;
  readonly sent: MainToHost[] = [];
  killed = false;

  postMessage(message: MainToHost): void {
    this.sent.push(message);
  }
  kill(): boolean {
    this.killed = true;
    return true;
  }
  send(message: unknown): void {
    this.emit('message', message);
  }
  ready(): void {
    this.send({ kind: 'ready', pid: this.pid });
  }
  exit(code = 1): void {
    this.emit('exit', code);
  }
  lastRequestId(): number {
    const request = this.sent.findLast((m) => m.kind === 'request');
    if (!request || request.kind !== 'request') throw new Error('no request sent');
    return request.id;
  }
}

function fakeLogger(): Logger {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  return log as unknown as Logger;
}

let hosts: FakeHost[];
let log: Logger;

function supervisor(options: Partial<ConstructorParameters<typeof PtyHostSupervisor>[0]> = {}) {
  return new PtyHostSupervisor({
    fork: () => {
      const host = new FakeHost();
      hosts.push(host);
      return host;
    },
    log,
    now: () => Date.now(),
    ...options,
  });
}

/** Starts a supervisor and makes its first host ready. */
function running(options?: Parameters<typeof supervisor>[0]) {
  const sup = supervisor(options);
  sup.start();
  hosts[0]!.ready();
  return sup;
}

beforeEach(() => {
  vi.useFakeTimers();
  hosts = [];
  log = fakeLogger();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('start', () => {
  it('is ready once the host says so', () => {
    const sup = supervisor();
    const onReady = vi.fn();
    sup.on('ready', onReady);
    sup.start();
    expect(sup.state).toBe('starting');
    expect(sup.pid).toBeUndefined();

    hosts[0]!.ready();
    expect(sup.state).toBe('ready');
    expect(sup.pid).toBe(hosts[0]!.pid);
    expect(onReady).toHaveBeenCalledWith(hosts[0]!.pid);
  });

  it('can only be started once', () => {
    const sup = running();
    expect(() => sup.start()).toThrow(/already started/);
  });

  it('kills and restarts a host that never becomes ready', () => {
    const sup = supervisor({ readyTimeoutMs: 1000 });
    sup.start();
    vi.advanceTimersByTime(1000);
    expect(hosts[0]!.killed).toBe(true);
    hosts[0]!.exit(1);
    vi.advanceTimersByTime(250);
    expect(hosts).toHaveLength(2);
    expect(sup.state).toBe('restarting');
    hosts[1]!.ready();
    expect(sup.state).toBe('ready');
  });

  it('retries when the process cannot be started at all', () => {
    let attempts = 0;
    const sup = supervisor({
      fork: () => {
        attempts++;
        if (attempts === 1) throw new Error('spawn failed');
        const host = new FakeHost();
        hosts.push(host);
        return host;
      },
    });
    sup.start();
    vi.advanceTimersByTime(250);
    hosts[0]!.ready();
    expect(sup.state).toBe('ready');
    expect(attempts).toBe(2);
  });
});

describe('request', () => {
  it('sends a request and resolves with the result', async () => {
    const sup = running();
    const result = sup.request('ping', undefined);
    const id = hosts[0]!.lastRequestId();
    expect(hosts[0]!.sent.at(-1)).toEqual({
      kind: 'request',
      id,
      method: 'ping',
      params: undefined,
    });
    hosts[0]!.send({ kind: 'response', id, ok: true, result: { pid: 1, uptimeMs: 5 } });
    await expect(result).resolves.toEqual({ pid: 1, uptimeMs: 5 });
  });

  it('rejects with the host error message', async () => {
    const sup = running();
    const result = sup.request('ping', undefined);
    hosts[0]!.send({
      kind: 'response',
      id: hosts[0]!.lastRequestId(),
      ok: false,
      error: { message: 'nope' },
    });
    await expect(result).rejects.toEqual(new PtyHostError('failed', 'nope'));
    await expect(result).rejects.toMatchObject({ reason: 'failed' });
  });

  it('times out, and ignores a late answer', async () => {
    const sup = running();
    const result = sup.request('ping', undefined, 500);
    const id = hosts[0]!.lastRequestId();
    vi.advanceTimersByTime(500);
    await expect(result).rejects.toThrow(/did not answer "ping" in time/);
    hosts[0]!.send({ kind: 'response', id, ok: true, result: {} });
  });

  it('rejects while the host is not ready', async () => {
    const sup = supervisor();
    await expect(sup.request('ping', undefined)).rejects.toThrow(/not running \(idle\)/);
    sup.start();
    await expect(sup.request('ping', undefined)).rejects.toThrow(/not running \(starting\)/);
  });

  it('rejects pending requests when the host exits', async () => {
    const sup = running();
    const result = sup.request('ping', undefined);
    hosts[0]!.exit(1);
    await expect(result).rejects.toThrow(/stopped/);
  });
});

describe('messages', () => {
  it('ignores invalid messages', () => {
    const sup = running();
    hosts[0]!.send({ kind: 'response', id: 'x' });
    hosts[0]!.send('garbage');
    hosts[0]!.send(null);
    expect(sup.state).toBe('ready');
    expect(log.warn).toHaveBeenCalledTimes(3);
  });

  it('writes host log records to the main log', () => {
    running();
    hosts[0]!.send({ kind: 'log', level: 'warn', msg: 'careful', data: { n: 1 } });
    hosts[0]!.send({ kind: 'log', level: 'debug', msg: 'detail' });
    expect(log.warn).toHaveBeenCalledWith({ n: 1 }, 'careful');
    expect(log.debug).toHaveBeenCalledWith({}, 'detail');
  });

  it('ignores messages from a host that was replaced', async () => {
    const sup = running();
    const old = hosts[0]!;
    old.exit(1);
    vi.advanceTimersByTime(250);
    hosts[1]!.ready();
    const result = sup.request('ping', undefined);
    const id = hosts[1]!.lastRequestId();
    old.send({ kind: 'response', id, ok: false, error: { message: 'stale' } });
    old.exit(1); // a second exit from the old host must not trigger a restart
    hosts[1]!.send({ kind: 'response', id, ok: true, result: 'fresh' });
    await expect(result).resolves.toBe('fresh');
    expect(hosts).toHaveLength(2);
  });
});

describe('crashes', () => {
  it('restarts a crashed host and reports the exit as unexpected', () => {
    const sup = running();
    const onExit = vi.fn();
    sup.on('exit', onExit);
    hosts[0]!.exit(3);
    expect(onExit).toHaveBeenCalledWith({ code: 3, expected: false });
    expect(sup.state).toBe('restarting');
    expect(sup.pid).toBeUndefined();

    vi.advanceTimersByTime(249);
    expect(hosts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(hosts).toHaveLength(2);
    hosts[1]!.ready();
    expect(sup.state).toBe('ready');
    expect(sup.pid).toBe(hosts[1]!.pid);
  });

  it('waits longer after each crash', () => {
    running({ maxCrashes: 10 });
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      hosts.at(-1)!.exit(1);
      const before = hosts.length;
      let waited = 0;
      while (hosts.length === before) {
        vi.advanceTimersByTime(50);
        waited += 50;
      }
      waits.push(waited);
      hosts.at(-1)!.ready();
    }
    expect(waits).toEqual([250, 1000, 2000, 5000, 5000]);
  });

  it('gives up after too many crashes in a short time', () => {
    const sup = running({ maxCrashes: 3, crashWindowMs: 60_000 });
    const onFailed = vi.fn();
    sup.on('failed', onFailed);
    for (let i = 0; i < 3; i++) {
      hosts.at(-1)!.exit(1);
      vi.advanceTimersByTime(10_000);
      hosts.at(-1)!.ready();
    }
    expect(sup.state).toBe('failed');
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(log.fatal).toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(hosts).toHaveLength(3); // no more restarts
  });

  it('keeps restarting when crashes are far apart', () => {
    const sup = running({ maxCrashes: 3, crashWindowMs: 60_000 });
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(61_000);
      hosts.at(-1)!.exit(1);
      vi.advanceTimersByTime(250);
      hosts.at(-1)!.ready();
    }
    expect(sup.state).toBe('ready');
    expect(hosts).toHaveLength(7);
  });
});

describe('stop', () => {
  it('asks the host to shut down and does not restart it', async () => {
    const sup = running();
    const onExit = vi.fn();
    sup.on('exit', onExit);
    const stopped = sup.stop();
    expect(sup.state).toBe('stopping');
    expect(hosts[0]!.sent.at(-1)).toEqual({ kind: 'shutdown' });

    hosts[0]!.exit(0);
    await stopped;
    expect(sup.state).toBe('stopped');
    expect(onExit).toHaveBeenCalledWith({ code: 0, expected: true });
    expect(hosts[0]!.killed).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(hosts).toHaveLength(1);
  });

  it('kills a host that does not exit in time', async () => {
    const sup = running({ stopTimeoutMs: 1000 });
    const stopped = sup.stop();
    vi.advanceTimersByTime(1000);
    expect(hosts[0]!.killed).toBe(true);
    hosts[0]!.exit(1);
    await stopped;
    expect(sup.state).toBe('stopped');
  });

  it('cancels a pending restart', async () => {
    const sup = running();
    hosts[0]!.exit(1);
    await sup.stop();
    vi.advanceTimersByTime(60_000);
    expect(hosts).toHaveLength(1);
    expect(sup.state).toBe('stopped');
  });

  it('returns the same promise when called twice', () => {
    const sup = running();
    expect(sup.stop()).toBe(sup.stop());
  });
});
