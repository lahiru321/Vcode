import { flipFuses, FuseV1Options, FuseVersion, type FuseConfig } from '@electron/fuses';

/**
 * Electron fuses for the packaged app (V1 doc §21): switches compiled into the Electron binary,
 * so they can't be turned back on from outside (environment variables, command-line flags).
 * Applied to the packaged executable before it is signed (P8). Every fuse is listed: a new one
 * in a later Electron fails `strictlyRequireAllFuses` until it gets a decision here.
 */
export const FUSES = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  // ELECTRON_RUN_AS_NODE would turn Vcode into a plain Node.js with its signature.
  [FuseV1Options.RunAsNode]: false,
  // Vcode keeps no cookies, but if anything ever does, they're encrypted at rest.
  [FuseV1Options.EnableCookieEncryption]: true,
  // NODE_OPTIONS and --inspect would let another program inject code into the main process.
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // Only the app's own (signed) app.asar is loaded, and its contents are checked.
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  // The renderer is a file:// page; it needs no privileges beyond a normal page's.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  // Electron's default; a safety and speed feature for WebAssembly.
  [FuseV1Options.WasmTrapHandlers]: true,
} satisfies FuseConfig;

/** Flips the fuses in the Electron executable at `electronPath` (e.g. `…/win-unpacked/Vcode.exe`). */
export function applyFuses(electronPath: string, isMac = false): Promise<number> {
  return flipFuses(electronPath, { ...FUSES, resetAdHocDarwinSignature: isMac });
}
