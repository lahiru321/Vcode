import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostToMain } from './protocol';

// Loads the host entry with a fake `process.parentPort` (Electron sets the real one in a
// utility process) and talks to it the way main does.

class FakeParentPort extends EventEmitter {
  readonly sent: unknown[] = [];
  postMessage(message: unknown): void {
    // Everything the host sends must pass main's validation.
    expect(HostToMain.safeParse(message).success).toBe(true);
    this.sent.push(message);
  }
  request(id: number, method: string, params?: unknown): void {
    this.emit('message', { data: { kind: 'request', id, method, params } });
  }
  async response(id: number): Promise<unknown> {
    await vi.waitFor(() => {
      expect(this.sent.some((m) => (m as { id?: number }).id === id)).toBe(true);
    });
    return this.sent.find((m) => (m as { id?: number }).id === id);
  }
}

let port: FakeParentPort;
const processWithPort = process as unknown as { parentPort?: FakeParentPort };

beforeEach(async () => {
  port = new FakeParentPort();
  processWithPort.parentPort = port;
  vi.resetModules();
  await import('.');
});

afterEach(() => {
  delete processWithPort.parentPort;
  process.removeAllListeners('uncaughtException');
});

describe('PTY host entry', () => {
  it('reports ready with its pid on start', () => {
    expect(port.sent[0]).toEqual({ kind: 'ready', pid: process.pid });
  });

  it('answers ping', async () => {
    port.request(7, 'ping');
    expect(await port.response(7)).toEqual({
      kind: 'response',
      id: 7,
      ok: true,
      result: { pid: process.pid, uptimeMs: expect.any(Number) },
    });
  });

  it('answers an unknown method with an error', async () => {
    port.request(8, 'format-disk');
    expect(await port.response(8)).toEqual({
      kind: 'response',
      id: 8,
      ok: false,
      error: { message: 'Unknown method: format-disk' },
    });
  });

  it('exits cleanly on shutdown', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    port.emit('message', { data: { kind: 'shutdown' } });
    expect(port.sent.at(-1)).toEqual({ kind: 'log', level: 'info', msg: 'shutting down' });
    expect(exit).toHaveBeenCalledWith(0);
  });
});
