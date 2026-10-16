# Security checklist (V1 doc §21)

Reviewed 2026-10-16 (P7-06) against the code at that date. Each item says where it is enforced and
how it is checked. Re-check this list when Electron is upgraded or a new window, IPC channel or
process type is added.

Status: **Done**, **P8** (needs the installer, tracked there), or **Partial** (see the note).

## Electron hardening

| # | Requirement | Status | Where / how it is checked |
|---|---|---|---|
| 1 | `contextIsolation` and `sandbox` on, `nodeIntegration` off in every window | Done | `src/main/index.ts` (the only window). `app.enableSandbox()` in `src/main/security.ts` sandboxes every renderer even if a window forgets. `<webview>` is refused (`will-attach-webview`). |
| 2 | Minimal typed preload API; never expose `ipcRenderer` | Done | `src/preload/index.ts` exposes only `invoke` / `on`, limited to the channel lists in `packages/shared/src/ipc/channels.ts`. The event object (and its `sender`) is not passed to the page. |
| 3 | Verify the sender of every IPC message and validate every payload | Done | `src/main/ipc/registry.ts`: top frame of an app window with the app's own URL only (`FORBIDDEN_SENDER` otherwise); every request and response checked against its zod contract (`contracts.ts`); requests are strict objects; every channel must have a handler at startup. Tests: `registry.test.ts`, `contracts.test.ts`. |
| 4 | Strict CSP; load only bundled app files | Done | `build/csp.ts`: `default-src 'none'`, scripts only `'self'`, no network except Vite's dev server. The built UI is served on `app://vcode/` by `src/main/renderer.ts`, which hands out only files under `out/renderer` (encoded `..%2f` / `..%5c` refused; tests in `renderer.test.ts`) — not `file://`, whose extra privileges the fuses remove. `'unsafe-inline'` for styles only (Radix, xterm.js). |
| 5 | Block navigation and new windows; external links only http(s), after confirmation | Done | `src/main/security.ts`: `will-navigate` / `will-redirect` blocked, `setWindowOpenHandler` denies; http(s) links open in the browser after "Open this link in your browser?" showing the real URL. Tests: `security.test.ts`. |
| 6 | Fuses: RunAsNode off, OnlyLoadAppFromAsar on, ASAR integrity validation on | Done | `build/fuses.ts` decides every fuse (`strictlyRequireAllFuses`, so a new Electron fuse fails until decided): also NODE_OPTIONS and `--inspect` off, cookie encryption on, no extra file:// privileges. `build/fuses.test.ts` flips a copy of the executable and reads them back. Applied to the packaged executable by `build/after-pack.mjs` (P8-01), after electron-builder embeds the ASAR integrity hash. Checked on the packaged app: it starts and runs terminals and agents with every fuse set; `ELECTRON_RUN_AS_NODE=1` no longer makes it run as Node. Chromium's `--remote-debugging-port` / `--remote-debugging-pipe` aren't covered by fuses, so the packaged app refuses to start with them (`src/main/index.ts`; checked: exits 1, no DevTools endpoint). |
| 7 | Keep Electron and native modules up to date | Done | Electron 44.5.1 → **44.8.0** (latest 44.x at review). better-sqlite3 13.0.3 and node-pty 1.1.0 are the latest releases. Re-check before each release. |

## Data and process security

| # | Requirement | Status | Where / how it is checked |
|---|---|---|---|
| 8 | Encrypt credentials with safeStorage | Done | `src/main/credentials/service.ts` (Windows DPAPI). A secret that can't be decrypted marks the key `unavailable`. |
| 9 | Never send stored secrets to the renderer | Done | The `Credential` contract has no secret field and responses strip unknown keys. The key is decrypted only into the agent's PTY environment at launch. |
| 10 | Restrict terminal execution to registered workspaces | Done | `terminals:create` takes a project / workspace id, never a path; the folder is checked on every start and restart (`src/main/terminals/service.ts`). |
| 11 | Resolve and validate paths (traversal, symlink escapes) | Done | `src/main/fs/folders.ts` (`resolveWorkspaceFolder`, `planWorkspaceFolder`): `realpath` of root and folder, then containment. Reveal / Open in VS Code / changes look the folder up by workspace id and check it again. Tests: `folders.test.ts`, `workspaces/*.test.ts`. |
| 12 | Process / resource limits where practical | Done | `maxTerminals` setting (default 16) checked inside the insert transaction; git commands time out (60 s, 5 min for a checkout); command output buffers are capped; terminal scrollback is fixed. |
| 13 | Audit terminal creation, agent start/stop, credential changes, workspace operations | Done | `src/main/audit/service.ts` and the IPC handlers (P7-05); viewer in the sidebar. Agent settings changes record only which fields changed. |
| 14 | Redact recognizable secrets from persisted logs | Done | `src/main/logging/redact.ts` on every log line (key names and secret-shaped values); the audit log passes its text through the same function. Tests: `redact.test.ts`, `audit/service.test.ts`. |
| 15 | Treat repository content and agent output as untrusted | Done | Terminal links (detected and OSC 8) go through the confirmation in #5; OSC 52 clipboard writes are swallowed (`renderer/src/features/terminals/safety.ts`, tests in `safety.test.ts`). Git runs with hooks and fsmonitor off and `GIT_*` variables removed (`src/main/git/cli.ts`); a project's `.git` is otherwise only read as files (`git/detect.ts`). |
| 16 | Provider-supported authentication only | Done | Agents use their CLI's own login or the provider's API-key variable (`packages/adapters`). Vcode never handles OAuth tokens. |
| 17 | Sign the Windows installer (Authenticode) | P8 | P8-03, after the certificate decision (ROADMAP → Open decisions). |

## Notes

- Browser permissions (camera, notifications, clipboard, …) are all denied for the page (`security.ts`); clipboard access goes through `clipboard:*` IPC instead.
- The PTY host is a utility process without Electron APIs. It talks to the renderer only over per-terminal MessagePorts that main hands to the requesting window.
- Dev builds keep Electron's defaults (no fuses) and allow remote debugging. Only the packaged executable is fused.
