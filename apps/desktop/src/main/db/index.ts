import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

// Copied next to the main bundle by build/copy-migrations.ts.
const MIGRATIONS_FOLDER = join(__dirname, 'migrations');

let database: AppDatabase | undefined;

/**
 * Opens (or creates) the database and applies pending migrations. Spec: V1 doc §8.
 * Throws if the file can't be opened or a migration fails; the caller shows the error.
 */
export function openDatabase(file: string): AppDatabase {
  const client = new Database(file);
  try {
    // WAL: readers don't block the writer, and NORMAL sync is crash-safe in this mode.
    if (client.pragma('journal_mode = WAL', { simple: true }) !== 'wal') {
      throw new Error('Could not switch the database to WAL mode');
    }
    client.pragma('synchronous = NORMAL');
    client.pragma('busy_timeout = 5000');

    const db = drizzle({ client, schema });

    // Migrations that rebuild a table need foreign keys off, and SQLite ignores that pragma
    // inside the transaction the migrator uses — so switch it off around the migrator and
    // check integrity before turning enforcement on.
    client.pragma('foreign_keys = OFF');
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const violations = client.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) {
      throw new Error(`Foreign key check failed after migration: ${JSON.stringify(violations)}`);
    }
    client.pragma('foreign_keys = ON');

    return db;
  } catch (error) {
    client.close();
    throw error;
  }
}

/** Opens the app database in `userDataDir` and keeps it for getDatabase(). */
export function initDatabase(userDataDir: string): AppDatabase {
  if (database) {
    throw new Error('Database already initialised');
  }
  database = openDatabase(join(userDataDir, 'vcode.db'));
  return database;
}

export function getDatabase(): AppDatabase {
  if (!database) {
    throw new Error('Database not initialised: call initDatabase() at startup');
  }
  return database;
}

export function closeDatabase(): void {
  database?.$client.close();
  database = undefined;
}

export { schema };
