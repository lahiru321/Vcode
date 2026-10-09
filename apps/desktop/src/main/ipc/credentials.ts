import { deleteCredential, listCredentials, safeStorageBox, setCredential } from '../credentials';
import { getDatabase } from '../db';
import { handle } from './registry';

export function registerCredentialHandlers(): void {
  handle('credentials:list', () => listCredentials(getDatabase()));
  handle('credentials:set', (request) => setCredential(getDatabase(), safeStorageBox, request));
  handle('credentials:delete', ({ id }) => deleteCredential(getDatabase(), id));
}
