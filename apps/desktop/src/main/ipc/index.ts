import { registerAppHandlers } from './app';
import { registerDialogHandlers } from './dialog';
import { registerProjectHandlers } from './projects';
import { assertAllChannelsHandled } from './registry';

export { broadcastEvent, sendEvent } from './registry';

/** Registers every IPC handler. Call before the first window loads. */
export function registerIpcHandlers(): void {
  registerAppHandlers();
  registerDialogHandlers();
  registerProjectHandlers();
  assertAllChannelsHandled();
}
