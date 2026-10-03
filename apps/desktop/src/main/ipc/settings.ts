import { getDatabase } from '../db';
import { getSettings, updateSettings } from '../settings/store';
import { handle } from './registry';

export function registerSettingsHandlers(): void {
  handle('settings:get', () => getSettings(getDatabase()));
  handle('settings:set', (patch) => updateSettings(getDatabase(), patch));
}
