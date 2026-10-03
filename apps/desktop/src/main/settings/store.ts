import { SETTING_DEFAULTS, Settings, type SettingKey } from '@vcode/shared';
import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppDatabase } from '../db';
import { appSettings } from '../db/schema';
import { createLogger } from '../logging';

// Key/value store over `app_settings` (V1 doc §8). Every value is validated when read, so a row
// written by an older version, or edited by hand, falls back to the default instead of
// reaching the app. Functions take the database so tests can pass their own.

type Writable = Pick<AppDatabase, 'insert'>;

const log = createLogger('settings');

/** Reads one value; `fallback` if the row is missing or doesn't match `schema`. */
export function readSetting<T>(db: AppDatabase, key: string, schema: z.ZodType<T>, fallback: T): T {
  let row: { valueJson: unknown } | undefined;
  try {
    row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  } catch (error) {
    // Drizzle parses the JSON column while reading, so a corrupt value throws here.
    log.warn({ key, err: error }, 'could not read a setting; using the default');
    return fallback;
  }
  if (!row) {
    return fallback;
  }
  const parsed = schema.safeParse(row.valueJson);
  if (!parsed.success) {
    log.warn({ key, issues: parsed.error.issues }, 'invalid setting; using the default');
    return fallback;
  }
  return parsed.data;
}

export function writeSetting(db: Writable, key: string, value: unknown): void {
  // Serialised here because Drizzle's json mode would store `null` as SQL NULL (the column is
  // NOT NULL) rather than the JSON text "null".
  const valueJson = sql`${JSON.stringify(value)}`;
  db.insert(appSettings)
    .values({ key, valueJson })
    .onConflictDoUpdate({ target: appSettings.key, set: { valueJson } })
    .run();
}

/** All renderer-visible settings, with defaults filled in. */
export function getSettings(db: AppDatabase): Settings {
  const settings = { ...SETTING_DEFAULTS };
  for (const key of Object.keys(Settings.shape) as SettingKey[]) {
    const schema: z.ZodType<Settings[SettingKey]> = Settings.shape[key];
    settings[key] = readSetting(db, key, schema, SETTING_DEFAULTS[key]);
  }
  return settings;
}

/** Writes the given keys in one transaction and returns the full settings. */
export function updateSettings(db: AppDatabase, patch: Partial<Settings>): Settings {
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        writeSetting(tx, key, value);
      }
    }
  });
  return getSettings(db);
}
