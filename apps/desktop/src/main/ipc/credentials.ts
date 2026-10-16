import { recordAudit } from '../audit/service';
import {
  deleteCredential,
  getCredential,
  listCredentials,
  safeStorageBox,
  setCredential,
} from '../credentials';
import { getDatabase } from '../db';
import { handle } from './registry';

export function registerCredentialHandlers(): void {
  handle('credentials:list', () => listCredentials(getDatabase()));
  handle('credentials:set', (request) => {
    const credential = setCredential(getDatabase(), safeStorageBox, request);
    // Never the key itself; only whether a new one was saved.
    recordAudit(getDatabase(), {
      action: request.id ? 'credential.update' : 'credential.create',
      resourceType: 'credential',
      resourceId: credential.id,
      metadata: {
        name: credential.name,
        provider: credential.provider,
        envVar: credential.envVar,
        newKey: request.id ? Boolean(request.secret) : undefined,
      },
    });
    return credential;
  });
  handle('credentials:delete', ({ id }) => {
    const before = getCredential(getDatabase(), id);
    const result = deleteCredential(getDatabase(), id);
    recordAudit(getDatabase(), {
      action: 'credential.delete',
      resourceType: 'credential',
      resourceId: id,
      metadata: { name: before.name, provider: before.provider },
    });
    return result;
  });
}
