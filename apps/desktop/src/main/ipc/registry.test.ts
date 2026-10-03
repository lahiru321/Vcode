import type * as SharedModule from '@vcode/shared';
import type { IpcResult } from '@vcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RegistryModule from './registry';

// Electron is replaced by a fake ipcMain that records handlers, and a fake BrowserWindow that
// knows one "window" web contents. The registry keeps module state, so each test reloads it.

type RawHandler = (event: unknown, payload: unknown) => Promise<IpcResult<unknown>>;

const electron = vi.hoisted(() => {
  const ourContents = { id: 1, send: vi.fn() };
  return {
    ourContents,
    handlers: new Map<string, RawHandler>(),
    ipcMain: {
      handle: (channel: string, handler: RawHandler) => electron.handlers.set(channel, handler),
    },
    BrowserWindow: {
      fromWebContents: (contents: unknown) => (contents === ourContents ? {} : null),
      getAllWindows: () => [{ webContents: ourContents }],
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain, BrowserWindow: electron.BrowserWindow }));
vi.mock('../renderer', () => ({ isRendererUrl: (url: string) => url === 'app://ui/index.html' }));

let registry: typeof RegistryModule;
// Reloaded with the registry: its `instanceof IpcError` check needs the same class.
let shared: typeof SharedModule;

beforeEach(async () => {
  electron.handlers.clear();
  electron.ourContents.send.mockClear();
  vi.resetModules();
  registry = await import('./registry');
  shared = await import('@vcode/shared');
});

const ID = '7d0f8a4e-5b1c-4e2a-9f3d-6c8b7a9e0d1f';
const PROJECT = {
  id: ID,
  name: 'n',
  slug: 's',
  rootPath: '/p',
  defaultBranch: null,
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
} as const;

/** An invoke event from our window's main frame, with overrides for the untrusted cases. */
function event(overrides: { url?: string; parent?: unknown; sender?: unknown } = {}) {
  return {
    sender: overrides.sender ?? electron.ourContents,
    senderFrame: { url: overrides.url ?? 'app://ui/index.html', parent: overrides.parent ?? null },
  };
}

function call(channel: string, payload?: unknown, evt: unknown = event()) {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(evt, payload);
}

describe('handle', () => {
  it('passes the validated request and wraps the response', async () => {
    const handler = vi.fn(() => PROJECT);
    registry.handle('projects:get', handler);
    await expect(call('projects:get', { id: ID })).resolves.toEqual({ ok: true, data: PROJECT });
    expect(handler).toHaveBeenCalledWith({ id: ID }, { sender: electron.ourContents });
  });

  it.each([
    ['a sub-frame', event({ parent: {} })],
    ['another page', event({ url: 'https://evil.example/' })],
    ['a web contents that is not our window', event({ sender: { id: 2 } })],
  ])('refuses calls from %s', async (_name, evt) => {
    const handler = vi.fn();
    registry.handle('app:getInfo', handler);
    await expect(call('app:getInfo', undefined, evt)).resolves.toEqual({
      ok: false,
      error: { code: 'FORBIDDEN_SENDER', message: expect.any(String) },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a call with no sender frame', async () => {
    registry.handle('app:getInfo', vi.fn());
    const evt = { sender: electron.ourContents, senderFrame: null };
    await expect(call('app:getInfo', undefined, evt)).resolves.toMatchObject({
      error: { code: 'FORBIDDEN_SENDER' },
    });
  });

  it('rejects invalid requests before the handler runs', async () => {
    const handler = vi.fn();
    registry.handle('projects:get', handler);
    for (const payload of [undefined, { id: 'nope' }, { id: ID, extra: true }]) {
      await expect(call('projects:get', payload)).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_REQUEST' },
      });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('strips fields the response schema does not know', async () => {
    registry.handle('projects:get', () => ({ ...PROJECT, secret: 'x' }) as typeof PROJECT);
    const result = await call('projects:get', { id: ID });
    expect(result).toEqual({ ok: true, data: PROJECT });
  });

  it('turns IpcError into its code and message', async () => {
    registry.handle('projects:get', () => {
      throw new shared.IpcError('NOT_FOUND', 'Project not found.');
    });
    await expect(call('projects:get', { id: ID })).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Project not found.' },
    });
  });

  it('hides other errors, including async ones, behind INTERNAL', async () => {
    registry.handle('projects:get', async () => {
      throw new Error('SQLITE_BUSY at C:\\secret\\path');
    });
    const result = await call('projects:get', { id: ID });
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: expect.not.stringContaining('secret') },
    });
  });

  it('treats a response that fails its schema as INTERNAL', async () => {
    registry.handle('projects:get', () => ({ id: 'nope' }) as unknown as typeof PROJECT);
    await expect(call('projects:get', { id: ID })).resolves.toMatchObject({
      error: { code: 'INTERNAL' },
    });
  });

  it('refuses to register a channel twice', () => {
    registry.handle('app:getInfo', vi.fn());
    expect(() => registry.handle('app:getInfo', vi.fn())).toThrow(/twice/);
  });
});

describe('assertAllChannelsHandled', () => {
  it('names the channels that have no handler', () => {
    registry.handle('app:getInfo', vi.fn());
    expect(() => registry.assertAllChannelsHandled()).toThrow(/projects:list/);
  });

  it('passes once every channel is registered', async () => {
    for (const channel of shared.INVOKE_CHANNELS) {
      registry.handle(channel, vi.fn());
    }
    expect(() => registry.assertAllChannelsHandled()).not.toThrow();
  });
});

describe('sendEvent / broadcastEvent', () => {
  it('validates the payload before sending', () => {
    registry.broadcastEvent('app:notice', { level: 'info', message: 'hi' });
    expect(electron.ourContents.send).toHaveBeenCalledWith('app:notice', {
      level: 'info',
      message: 'hi',
    });
    expect(() =>
      registry.broadcastEvent('app:notice', { level: 'loud', message: 'x' } as never),
    ).toThrow();
  });
});
