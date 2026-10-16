import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../src/main/testing';
import { applyFuses, FUSES } from './fuses';

/**
 * The Electron executable, read from the package's `path.txt` rather than by requiring it:
 * since Electron 44.8 that starts a download when the binary is missing, and CI's unit-test job
 * skips it on purpose. Null when it isn't there.
 */
function findElectron(): string | null {
  try {
    const dir = dirname(createRequire(import.meta.url).resolve('electron/package.json'));
    const path = join(dir, 'dist', readFileSync(join(dir, 'path.txt'), 'utf8').trim());
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}
const found = findElectron();
const electronPath = found ?? '';

describe.runIf(found !== null)('Electron fuses', () => {
  it('decides every fuse this Electron has', async () => {
    const wire = await getCurrentFuseWire(electronPath);
    const known = Object.keys(wire).filter((key) => key !== 'version');
    const decided = Object.keys(FUSES).filter((key) => /^\d+$/.test(key));
    expect(decided.sort()).toEqual(known.sort());
  });

  // Copies the ~200 MB executable: once, on the platform the app ships on first.
  it.runIf(basename(electronPath).endsWith('.exe'))(
    'flips them in a copy of the executable',
    { timeout: 60_000 },
    async () => {
      const copy = join(tempDir(), 'electron.exe');
      copyFileSync(electronPath, copy);
      await applyFuses(copy);
      const wire = await getCurrentFuseWire(copy);
      expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE);
      expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(FuseState.DISABLE);
      expect(wire[FuseV1Options.EnableNodeCliInspectArguments]).toBe(FuseState.DISABLE);
      expect(wire[FuseV1Options.OnlyLoadAppFromAsar]).toBe(FuseState.ENABLE);
      expect(wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(FuseState.ENABLE);
      expect(wire[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(FuseState.DISABLE);
      // The original is untouched (dev and tests still run it as Node).
      expect((await getCurrentFuseWire(electronPath))[FuseV1Options.RunAsNode]).toBe(
        FuseState.ENABLE,
      );
    },
  );
});
