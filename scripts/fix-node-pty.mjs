// node-pty 1.1.0 is published with prebuilds/darwin-*/spawn-helper not executable (mode 644),
// so every terminal fails on macOS with "posix_spawnp failed". Runs after `pnpm install` and
// makes it executable again. Done at install time rather than at runtime because a signed
// macOS app bundle can't be modified, and packaging (P8) copies the mode set here.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps', 'desktop', 'package.json'));

let nodePty;
try {
  nodePty = dirname(require.resolve('node-pty/package.json'));
} catch {
  process.exit(0); // not installed (e.g. a filtered install)
}

const prebuilds = join(nodePty, 'prebuilds');
for (const dir of existsSync(prebuilds) ? readdirSync(prebuilds) : []) {
  const helper = join(prebuilds, dir, 'spawn-helper');
  if (dir.startsWith('darwin-') && existsSync(helper) && (statSync(helper).mode & 0o111) === 0) {
    chmodSync(helper, 0o755);
    // Windows has no execute bit; only report a change that took effect.
    if ((statSync(helper).mode & 0o111) !== 0) {
      console.log(`fix-node-pty: made ${dir}/spawn-helper executable`);
    }
  }
}
