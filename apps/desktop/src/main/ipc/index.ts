import { registerAgentHandlers } from './agents';
import { registerAppHandlers } from './app';
import { registerDialogHandlers } from './dialog';
import { registerProjectHandlers } from './projects';
import { assertAllChannelsHandled } from './registry';
import { registerSettingsHandlers } from './settings';
import { registerTerminalHandlers } from './terminals';

export { broadcastEvent, sendEvent } from './registry';

/** Registers every IPC handler. Call before the first window loads. */
export function registerIpcHandlers(): void {
  registerAppHandlers();
  registerAgentHandlers();
  registerDialogHandlers();
  registerProjectHandlers();
  registerSettingsHandlers();
  registerTerminalHandlers();
  assertAllChannelsHandled();
}
