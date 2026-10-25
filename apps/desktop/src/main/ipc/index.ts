import { registerAgentHandlers } from './agents';
import { registerAppHandlers } from './app';
import { registerAuditHandlers } from './audit';
import { registerClipboardHandlers } from './clipboard';
import { registerCredentialHandlers } from './credentials';
import { registerDialogHandlers } from './dialog';
import { registerMarkdownHandlers } from './markdown';
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
  registerAuditHandlers();
  registerClipboardHandlers();
  registerAgentHandlers();
  registerCredentialHandlers();
  registerDialogHandlers();
  registerMarkdownHandlers();
  registerProjectHandlers();
  registerRepositoryHandlers();
  registerSettingsHandlers();
  registerTerminalHandlers();
  registerWorkspaceHandlers();
  assertAllChannelsHandled();
}
