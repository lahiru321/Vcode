import type { EventPayload, InvokeArgs, InvokeResponse, IpcResult } from '@agent-hub/shared';
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type InvokeChannel,
} from '@agent-hub/shared/ipc/channels';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// The only bridge between the sandboxed renderer and the main process. ipcRenderer itself is
// never exposed: the renderer can reach only the channels listed in packages/shared, and main
// checks the sender and validates every payload. Spec: V1 doc §20–21.

const invokeChannels = new Set<string>(INVOKE_CHANNELS);
const eventChannels = new Set<string>(EVENT_CHANNELS);

const api = {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeArgs<C>
  ): Promise<IpcResult<InvokeResponse<C>>> {
    if (!invokeChannels.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL', message: `Unknown IPC channel: ${String(channel)}` },
      });
    }
    return ipcRenderer.invoke(channel, args[0]);
  },

  /** Subscribes to a main → renderer event. Returns a function that unsubscribes. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void {
    if (!eventChannels.has(channel)) {
      throw new Error(`Unknown IPC event: ${String(channel)}`);
    }
    // Don't hand the IpcRendererEvent (and its `sender`) to the page.
    const wrapped = (_event: IpcRendererEvent, payload: EventPayload<C>): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

export type AgentHubApi = typeof api;

contextBridge.exposeInMainWorld('agentHub', api);
