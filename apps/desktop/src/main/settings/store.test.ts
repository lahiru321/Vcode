import { SETTING_DEFAULTS } from '@vcode/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { testDatabase } from '../testing';
import { getSettings, readSetting, updateSettings, writeSetting } from './store';

const ID = '7d0f8a4e-5b1c-4e2a-9f3d-6c8b7a9e0d1f';

function rawValue(db: ReturnType<typeof testDatabase>, key: string): unknown {
  return db.$client.prepare('select value_json from app_settings where key = ?').pluck().get(key);
}

describe('readSetting / writeSetting', () => {
  const Point = z.object({ x: z.number(), y: z.number() });

  it('returns the fallback for a missing key', () => {
    expect(readSetting(testDatabase(), 'nope', Point, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('round-trips values, replacing the previous one', () => {
    const db = testDatabase();
    writeSetting(db, 'p', { x: 1, y: 2 });
    writeSetting(db, 'p', { x: 3, y: 4 });
    expect(readSetting(db, 'p', Point, null)).toEqual({ x: 3, y: 4 });
  });

  it('stores null as JSON text, not SQL NULL', () => {
    const db = testDatabase();
    writeSetting(db, 'n', null);
    expect(rawValue(db, 'n')).toBe('null');
    expect(readSetting(db, 'n', z.string().nullable(), 'fallback')).toBeNull();
  });

  it('falls back when the stored value no longer matches the schema', () => {
    const db = testDatabase();
    writeSetting(db, 'p', { x: 'one' });
    expect(readSetting(db, 'p', Point, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('falls back when the stored text is not JSON', () => {
    const db = testDatabase();
    db.$client.prepare("insert into app_settings values ('p', '{oops')").run();
    expect(readSetting(db, 'p', Point, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('getSettings / updateSettings', () => {
  it('returns the defaults on a fresh database', () => {
    expect(getSettings(testDatabase())).toEqual(SETTING_DEFAULTS);
  });

  it('stores each setting under its own key', () => {
    const db = testDatabase();
    expect(updateSettings(db, { selectedProjectId: ID })).toEqual({ selectedProjectId: ID });
    expect(rawValue(db, 'selectedProjectId')).toBe(JSON.stringify(ID));
    expect(updateSettings(db, { selectedProjectId: null })).toEqual({ selectedProjectId: null });
  });

  it('leaves keys that are not in the patch alone', () => {
    const db = testDatabase();
    updateSettings(db, { selectedProjectId: ID });
    expect(updateSettings(db, {})).toEqual({ selectedProjectId: ID });
  });

  it('ignores an invalid stored setting', () => {
    const db = testDatabase();
    writeSetting(db, 'selectedProjectId', 'not-a-uuid');
    expect(getSettings(db)).toEqual(SETTING_DEFAULTS);
  });

  it('does not expose main-only keys', () => {
    const db = testDatabase();
    writeSetting(db, 'window.main', { x: 0 });
    expect(Object.keys(getSettings(db))).toEqual(Object.keys(SETTING_DEFAULTS));
  });
});
