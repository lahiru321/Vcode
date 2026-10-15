import { registerAgentHandlers } from './agents';
import { registerAppHandlers } from './app';
import { registerClipboardHandlers } from './clipboard';
import { registerCredentialHandlers } from './credentials';
import { registerDialogHandlers } from './dialog';
import { registerProjectHandlers } from './projects';
import { assertAllChannelsHandled } from './registry';
import { registerRepositoryHandlers } from './repositories';
import { registerSettingsHandlers } from './settings';
import { registerTerminalHandlers } from './terminals';
import { registerWorkspaceHandlers } from './workspaces';

export { broadcastEvent, sendEvent } from './registry';

/** Registers every IPC handler. Call before the first window loads. */
export function registerIpcHandlers(): void {
  registerAppHandlers();
  registerClipboardHandlers();
  registerAgentHandlers();
  registerCredentialHandlers();
  registerDialogHandlers();
  registerProjectHandlers();
  registerRepositoryHandlers();
  registerSettingsHandlers();
  registerTerminalHandlers();
  registerWorkspaceHandlers();
  assertAllChannelsHandled();
}
