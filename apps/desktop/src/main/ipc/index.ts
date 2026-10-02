import { registerAppHandlers } from './app';
import { assertAllChannelsHandled } from './registry';

export { broadcastEvent, sendEvent } from './registry';

/** Registers every IPC handler. Call before the first window loads. */
export function registerIpcHandlers(): void {
  registerAppHandlers();
  assertAllChannelsHandled();
}
