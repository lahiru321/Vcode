import { safeStorage } from 'electron';
import type { SecretBox } from './service';

export {
  credentialEnvironment,
  deleteCredential,
  getCredential,
  listCredentials,
  setCredential,
  type SecretBox,
} from './service';

/**
 * Electron safeStorage: DPAPI on Windows, Keychain on macOS (V1 doc §16). Bound to the OS user,
 * so a database copied to another user or computer can't be decrypted there.
 */
export const safeStorageBox: SecretBox = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (secret) => safeStorage.encryptString(secret),
  decrypt: (encrypted) => safeStorage.decryptString(encrypted),
};
