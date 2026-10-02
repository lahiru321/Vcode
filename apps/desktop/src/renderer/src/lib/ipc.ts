import {
  IpcError,
  type EventChannel,
  type EventPayload,
  type InvokeArgs,
  type InvokeChannel,
  type InvokeResponse,
} from '@vcode/shared';

/** Calls a main-process handler. Throws IpcError (with its `code`) if the call fails. */
export async function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResponse<C>> {
  const result = await window.vcode.invoke(channel, ...args);
  if (!result.ok) {
    throw new IpcError(result.error.code, result.error.message);
  }
  return result.data;
}

/** Subscribes to a main → renderer event. Returns a function that unsubscribes. */
export function onEvent<C extends EventChannel>(
  channel: C,
  listener: (payload: EventPayload<C>) => void,
): () => void {
  return window.vcode.on(channel, listener);
}
