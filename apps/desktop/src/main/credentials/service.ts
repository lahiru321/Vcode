import { IpcError, type Credential, type SetCredentialRequest } from '@vcode/shared';
import { count, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { agents, credentials } from '../db/schema';
import type { Environment } from '../platform';

// Credentials (V1 doc §16, §18 "credentials"): API keys for CLIs that read one from an
// environment variable. The secret is encrypted with the OS (safeStorage: DPAPI on Windows,
// Keychain on macOS) and decrypted only to start an agent, straight into its environment. It
// never goes back to the renderer, and nothing here logs it.

export type CredentialRow = typeof credentials.$inferSelect;

/** Encrypts secrets for this OS user. The real one is Electron's safeStorage (./index.ts). */
export interface SecretBox {
  isAvailable(): boolean;
  encrypt(secret: string): Buffer;
  /** Throws if this computer / user can't decrypt it. */
  decrypt(encrypted: Buffer): string;
}

/** Metadata only. Takes the row apart field by field, so the secret can't slip through. */
export function toCredential(row: CredentialRow, agentCount: number): Credential {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as Credential['provider'],
    envVar: row.envVar,
    status: row.status,
    agentCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function agentCounts(db: AppDatabase): Map<string, number> {
  const rows = db
    .select({ id: agents.credentialId, n: count() })
    .from(agents)
    .groupBy(agents.credentialId)
    .all();
  return new Map(rows.flatMap(({ id, n }) => (id ? [[id, n] as const] : [])));
}

/** Every credential, by name, as metadata. */
export function listCredentials(db: AppDatabase): Credential[] {
  const counts = agentCounts(db);
  return db
    .select()
    .from(credentials)
    .orderBy(sql`${credentials.name} collate nocase`)
    .all()
    .map((row) => toCredential(row, counts.get(row.id) ?? 0));
}

export function getCredential(db: AppDatabase, id: string): CredentialRow {
  const row = db.select().from(credentials).where(eq(credentials.id, id)).get();
  if (!row) {
    throw new IpcError('NOT_FOUND', 'API key not found. It may have been deleted.');
  }
  return row;
}

function encrypt(box: SecretBox, secret: string): Buffer {
  if (!box.isAvailable()) {
    throw new IpcError(
      'UNAVAILABLE',
      "This computer can't encrypt API keys right now, so the key wasn't saved.",
    );
  }
  return box.encrypt(secret);
}

function isNameTaken(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed: credentials\.name/.test(error.message)
  );
}

/** Creates a credential (no `id`) or changes one; a new secret replaces the old one. */
export function setCredential(
  db: AppDatabase,
  box: SecretBox,
  request: SetCredentialRequest,
): Credential {
  const secret = request.secret?.trim();
  const fields = { name: request.name, provider: request.provider, envVar: request.envVar };
  let row: CredentialRow;
  try {
    if (request.id) {
      getCredential(db, request.id);
      row =
        db
          .update(credentials)
          .set({
            ...fields,
            // A new secret can be decrypted again.
            ...(secret ? { encryptedSecret: encrypt(box, secret), status: 'active' as const } : {}),
          })
          .where(eq(credentials.id, request.id))
          .returning()
          .get() ?? getCredential(db, request.id);
    } else {
      if (!secret) {
        throw new IpcError('INVALID_REQUEST', 'Enter the key');
      }
      row = db
        .insert(credentials)
        .values({ ...fields, authType: 'api_key', encryptedSecret: encrypt(box, secret) })
        .returning()
        .get();
    }
  } catch (error) {
    if (isNameTaken(error)) {
      throw new IpcError('CONFLICT', `An API key named “${request.name}” already exists.`);
    }
    throw error;
  }
  return toCredential(row, agentCounts(db).get(row.id) ?? 0);
}

/** Deletes a credential; agents that used it go back to the CLI's own login. */
export function deleteCredential(db: AppDatabase, id: string): { id: string } {
  getCredential(db, id);
  db.delete(credentials).where(eq(credentials.id, id)).run();
  return { id };
}

/**
 * The variables to add to an agent's environment for its credential. A secret this computer
 * can't decrypt marks the credential `unavailable` and fails the start (UNAVAILABLE).
 */
export function credentialEnvironment(
  db: AppDatabase,
  box: SecretBox,
  credentialId: string,
): Environment {
  const row = getCredential(db, credentialId);
  let secret: string;
  try {
    secret = box.decrypt(row.encryptedSecret);
  } catch {
    db.update(credentials).set({ status: 'unavailable' }).where(eq(credentials.id, row.id)).run();
    throw new IpcError(
      'UNAVAILABLE',
      `The API key “${row.name}” can't be decrypted on this computer. Enter it again under API keys.`,
    );
  }
  if (row.status !== 'active') {
    db.update(credentials).set({ status: 'active' }).where(eq(credentials.id, row.id)).run();
  }
  return { [row.envVar]: secret };
}
