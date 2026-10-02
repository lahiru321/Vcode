import {
  eventContracts,
  INVOKE_CHANNELS,
  invokeContracts,
  IpcError,
  type EventChannel,
  type EventPayload,
  type InvokeChannel,
  type IpcErrorCode,
  type IpcResult,
} from '@vcode/shared';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { isRendererUrl } from '../renderer';

type Contract<C extends InvokeChannel> = (typeof invokeContracts)[C];

export interface HandlerContext {
  sender: WebContents;
}

/** Receives the validated request; its return value is validated against the response schema. */
export type Handler<C extends InvokeChannel> = (
  request: z.output<Contract<C>['request']>,
  context: HandlerContext,
) => z.input<Contract<C>['response']> | Promise<z.input<Contract<C>['response']>>;

const registered = new Set<InvokeChannel>();

function failure(code: IpcErrorCode, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } };
}

/** Only the main frame of one of our windows, showing our own UI, may call main. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return (
    frame !== null &&
    frame.parent === null &&
    BrowserWindow.fromWebContents(event.sender) !== null &&
    isRendererUrl(frame.url)
  );
}

export function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
  if (registered.has(channel)) {
    throw new Error(`IPC handler registered twice: ${channel}`);
  }
  registered.add(channel);

  const contract: { request: z.ZodType; response: z.ZodType } = invokeContracts[channel];

  ipcMain.handle(channel, async (event, payload: unknown): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(event)) {
      console.warn(`[ipc] rejected ${channel} from ${event.senderFrame?.url ?? 'unknown frame'}`);
      return failure('FORBIDDEN_SENDER', 'This sender may not use IPC.');
    }

    const request = contract.request.safeParse(payload);
    if (!request.success) {
      return failure('INVALID_REQUEST', z.prettifyError(request.error));
    }

    try {
      const response = await handler(request.data as z.output<Contract<C>['request']>, {
        sender: event.sender,
      });
      return { ok: true, data: contract.response.parse(response) };
    } catch (error) {
      if (error instanceof IpcError) {
        return failure(error.code, error.message);
      }
      // Includes responses that fail their schema: a bug in main, not the caller's fault.
      console.error(`[ipc] ${channel} failed:`, error);
      return failure('INTERNAL', 'Something went wrong. See the app log for details.');
    }
  });
}

/** Call once after all modules have registered, so a missing handler fails at startup. */
export function assertAllChannelsHandled(): void {
  const missing = INVOKE_CHANNELS.filter((channel) => !registered.has(channel));
  if (missing.length > 0) {
    throw new Error(`IPC channels without a handler: ${missing.join(', ')}`);
  }
}

export function sendEvent<C extends EventChannel>(
  contents: WebContents,
  channel: C,
  payload: EventPayload<C>,
): void {
  const schema: z.ZodType = eventContracts[channel];
  contents.send(channel, schema.parse(payload));
}

export function broadcastEvent<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
  for (const window of BrowserWindow.getAllWindows()) {
    sendEvent(window.webContents, channel, payload);
  }
}
