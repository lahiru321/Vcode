import { copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../src/main/testing';
import { applyFuses, FUSES } from './fuses';

// Outside Electron, the `electron` package exports the path of its executable.
const electronPath = createRequire(import.meta.url)('electron') as string;

describe('Electron fuses', () => {
  it('decides every fuse this Electron has', async () => {
    const wire = await getCurrentFuseWire(electronPath);
    const known = Object.keys(wire).filter((key) => key !== 'version');
    const decided = Object.keys(FUSES).filter((key) => /^\d+$/.test(key));
    expect(decided.sort()).toEqual(known.sort());
  });

  // Copies the ~200 MB executable: once, on the platform the app ships on first.
  it.runIf(existsSync(electronPath) && basename(electronPath).endsWith('.exe'))(
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
