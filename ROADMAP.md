# Vcode — Roadmap

A desktop app (Windows first, macOS later) for running and managing many AI coding CLIs (Claude Code, Gemini CLI, Codex CLI) side by side.

- **What to build** → the specs (source of truth):
  - `docs/AI_Agent_Hub_V1_Technical_Product_Document.docx` — V1 scope, architecture, acceptance criteria
  - `docs/AI_Agent_Hub_Vibe_Coding_Platform_Plan.docx` — long-term vision (V2+)
- **In what order, and how far along** → this file.

**Stack:** Electron · TypeScript (main process is the backend) · React · Tailwind + shadcn/ui · xterm.js · dockview · node-pty · SQLite + Drizzle · pnpm monorepo

---

## How to use this file

| Mark | Meaning |
|---|---|
| `[ ]` | To do |
| `[~]` | In progress |
| `[x]` | Done |
| `[-]` | Dropped (add a one-line reason) |

- **Task IDs:** `P<phase>-<nn>` (e.g. `P2-06`). Use them in commits and branch names.
- **Sizes:** `S` = under half a day · `M` = 1–3 days · `L` = 3+ days. No dates on purpose.
- **Rules:**
  - Tick tasks as you finish them, and keep **Now** current.
  - If a task changes, edit it and add a line to the **Changelog**.
  - A phase is done only when every **Done when** check passes.

---

## Now

**Current phase:** P3 — First CLI Agent

**Next up:**
1. `P3-03` Agents service + IPC (minimal create / list)
2. `P3-04` + `P3-05` Agents launch in the `main` workspace; `agent_sessions` lifecycle
3. `P3-06` + `P3-07` Status detection; "Start Claude Code" button

---

## Phase overview

| # | Phase | Goal | Size | Status |
|---|---|---|---|---|
| P1 | Foundation | App opens, projects persist, CI green on Windows + macOS | L | Done |
| P2 | Terminal Engine | A real PowerShell terminal that survives a UI reload | L | Done |
| P3 | First CLI Agent | Claude Code running end-to-end inside the app | M | To do |
| P4 | Agent Registry | Gemini, Codex and custom CLIs, plus encrypted API keys | M | To do |
| P5 | Multi-Terminal Workspace | Many agents side by side in a saved grid layout | M | To do |
| P6 | Workspace & Git | Each agent in its own folder / Git worktree | L | To do |
| P7 | Desktop Polish & Hardening | Tray, notifications, audit log, security review | M | To do |
| P8 | Distribution | Signed Windows installer with auto-update | M | To do |
| — | macOS Release | Same app on macOS | M | After V1 |
| — | V2+ | Orchestration, verification, project memory | — | Later |

---

## Ground rules (every phase)

These keep the macOS port cheap. Spec reference: V1 doc §6 *Cross-Platform Readiness*.

- **No `process.platform` outside `src/main/platform/`.** All OS differences go through the platform layer.
- **Paths:** only `path.join` / `path.resolve` / `app.getPath()`. No hard-coded drive letters, `\\`, or `.exe`.
- **Shortcuts:** always `CommandOrControl`, never `Ctrl` alone.
- **CI:** unit tests run on **Windows and macOS** for every push.
- **Secrets never reach the renderer.** Decrypt only in main, inject only into the PTY environment.
- **Renderer is untrusted:** validate every IPC payload with zod in main.

---

## P1 — Foundation

**Goal:** the app opens, projects can be added and persist, CI is green on Windows + macOS.
**Depends on:** nothing.

- [x] **P1-01** · Dev environment check: Node LTS, pnpm (via corepack), Git, Visual Studio C++ Build Tools (for native modules) · `S`
  - *2026-10-02:* Node 24.15 (x64) · pnpm 9.15 · Git 2.54 · VS Build Tools 2022 + C++ · Windows SDK 10.0.26100 · Python 3.14 · long paths on · Claude Code 2.1. Not yet: Gemini/Codex CLIs (needed in P4), `gh auth login` (needed in P1-16).
- [x] **P1-02** · Git repo at `D:\Vcode` + pnpm monorepo (`apps/desktop`, `packages/shared`, `packages/adapters`), base tsconfig, ESLint, Prettier; move the spec docs into `docs/` · `S`
  - *2026-10-02:* `apps/desktop` itself is created in P1-03. TypeScript pinned to `~6.0` because typescript-eslint doesn't support TS 7 yet.
- [x] **P1-03** · Scaffold Electron + electron-vite + React + TypeScript in `apps/desktop` · `M`
  - *2026-10-02:* Electron 44.5 · electron-vite 5 · Vite 7 (electron-vite doesn't support Vite 8 yet) · React 19.3. Preload is sandboxed and fully bundled; workspace packages are bundled into main. Window opens via `pnpm dev`.
- [x] **P1-04** · Tailwind + shadcn/ui; app shell (sidebar + main area); dark theme · `M`
  - *2026-10-02:* Tailwind 4 + shadcn `new-york` (Radix, neutral, CSS variables) with extra `success` / `warning` tokens. Shell: sidebar (Projects / Agents / Workspaces), top bar, empty state, status bar. Buttons are placeholders until P1-12. Note: the shadcn CLI can't resolve the `@renderer` alias — after `shadcn add`, change `from "cn"` to `from '@renderer/lib/utils'` and remove the `cn` package if it was added.
- [x] **P1-05** · Electron security baseline: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, block navigation and new windows · `S`
  - *2026-10-02:* `src/main/security.ts`: global `app.enableSandbox()`, all navigation/redirects/new windows/webviews blocked, http(s) links open in the system browser after a confirm dialog, all browser permissions denied. CSP injected by `build/csp.ts` (strict in production; dev also allows inline scripts + HMR WebSocket). DevTools disabled when packaged; renderer warnings/errors print to the dev terminal.
- [x] **P1-06** · Typed IPC: zod contracts in `packages/shared`, preload exposes `window.vcode`, main handler registry checks sender + validates payload · `M`
  - *2026-10-02:* zod 4. Channel names in `shared/src/ipc/channels.ts` (zod-free, so the preload bundle stays ~1 kB); schemas in `contracts.ts`. `window.vcode` = `invoke(channel, payload?)` + `on(event, listener) → unsubscribe`, allowlisted. Main `handle()` (`src/main/ipc/registry.ts`) rejects senders that aren't the main frame of our window showing our UI, validates request **and** response (unknown response keys stripped), and returns a `{ ok, data | error: { code, message } }` envelope; renderer `invoke()` in `lib/ipc.ts` unwraps it and throws `IpcError`. Handlers throw `IpcError('NOT_FOUND', …)` for domain errors. Startup fails if a channel has no handler. First channel: `app:getInfo` (status bar); first event: `app:notice`. Adding a channel: name in `channels.ts` → schemas in `contracts.ts` → `handle()` in a `src/main/ipc/<module>.ts` registered from `ipc/index.ts`.
- [x] **P1-07** · Platform layer: interface + `win32.ts` + `darwin.ts` stub (`defaultShell`, `resolveExecutable`, `killProcessTree`, `loadUserEnvironment`, `revealInFileManager`); lint rule banning `process.platform` elsewhere · `M`
  - *2026-10-02:* `src/main/platform/` → `platform` object (`index.ts` is the only `process.platform` check). Also has `shellArgs`, `buildCommand` and `fileManagerName`. **win32:** shell = `pwsh` on PATH, else Windows PowerShell. Executables come from PATH + PATHEXT (only .com/.exe/.bat/.cmd; .ps1 only when given as a path). The current directory is never searched; relative paths are refused; app execution aliases are found. `.cmd`/`.bat` run through `cmd.exe /d /s /c` with cross-spawn-style double `^` escaping; `Command.verbatimArguments` tells the PTY host not to re-quote. `killProcessTree` = `taskkill /T /F`. `loadUserEnvironment` reads the user + machine registry environment through Windows PowerShell (UTF-8, ~0.5 s, so cache it), with PATH = system;user. **darwin:** working but never run on a Mac: `$SHELL -l`, PATH lookup, SIGTERM → SIGKILL to the process group, `env -0` from an interactive login shell. ESLint bans `process.platform`, `os.platform` and importing `platform` from `os` outside this folder. Checked by hand on this machine: claude.exe / npm.cmd / npm.ps1 / app-alias resolution, 25 tricky arguments round-tripping through a `.cmd` shim, and tree kill of parent + grandchild.
- [x] **P1-08** · SQLite + Drizzle: all V1 tables (V1 doc §8), migrations at startup, WAL + foreign keys on, DB file in `userData` · `M`
  - *2026-10-02:* better-sqlite3 13 + drizzle-orm 0.45 / drizzle-kit 0.31. Schema in `src/main/db/schema.ts`; enum values in `packages/shared/src/domain.ts` (for reuse in zod contracts). Additions beyond the ER diagram: `created_at` on repositories/workspaces, `updated_at` on agents/credentials, unique `projects.slug` / `projects.root_path` / `workspaces.path` / `credentials.name` / (project, workspace name), FK indexes. Deletes: a project cascades to repos, workspaces, its agents and sessions; audit logs keep the row with `project_id = null`; a deleted credential sets `agents.credential_id = null`. DB at `userData/vcode.db` = `%APPDATA%\Vcode\` (set `productName` so the folder name is stable). WAL, `synchronous=NORMAL`, `busy_timeout=5000`, FKs on. Migrations run with FKs off (SQLite ignores that pragma inside the migrator's transaction), then `foreign_key_check`, then FKs on. `build/copy-migrations.ts` copies migrations into `out/main/migrations`. If the DB can't open, the app shows an error dialog and exits. Schema change → `pnpm db:generate` → commit the SQL.
- [x] **P1-09** · Native module rebuild for Electron (better-sqlite3 now, node-pty in P2) · `S`
  - *2026-10-02:* Not needed for better-sqlite3: v13 ships prebuilt **Node-API** binaries (`prebuilds/win32-x64.node`, `darwin-arm64`, …) that load unchanged in Node 24 and Electron 44, so Vitest can use the same install. No `@electron/rebuild`. *2026-10-03 correction:* pnpm still compiled it from source on install (implicit `node-gyp rebuild` because of its `binding.gyp`) — wasted work that the library never loads (`lib/<platform>.js` always requires `prebuilds/<platform>.node`) and that broke `pnpm install` on the CI Windows runner; root `package.json` now has `pnpm.neverBuiltDependencies: ["better-sqlite3"]`. Check node-pty in P2-01 (if it isn't Node-API, add `@electron/rebuild` then). *2026-10-03:* node-pty 1.1.0 is Node-API (`node-addon-api`) and ships `prebuilds/{win32,darwin}-{x64,arm64}`; its install script uses them (no compile), and its postinstall copies the bundled `conpty.dll` — keep its build scripts enabled. Verified spawning through ConPTY inside an Electron 44 `utilityProcess`: no rebuild needed. It loads a worker script and DLLs from its own folder, so it must stay external (not bundled) and, in P8, be `asarUnpack`ed as a whole. P8: native `.node` files must be `asarUnpack`ed.
- [x] **P1-10** · Projects service + IPC: list / create / get / update / delete · `S`
  - *2026-10-02:* `src/main/projects/service.ts` + `ipc/projects.ts`; contracts `Project`, `CreateProjectRequest` (`rootPath`, optional `name` → defaults to the folder name), `UpdateProjectRequest` (`name` and/or `status`; folder and slug never change), `ProjectIdRequest`. Request schemas are `z.strictObject` (unknown keys rejected). Slug from the name, made unique with `-2`, `-3`, …. List is sorted by name, case-insensitive. Delete removes DB rows only (cascades), never files. Errors: `INVALID_REQUEST` (bad folder / input), `CONFLICT` (folder already a project), `NOT_FOUND`. Not yet: refusing delete while terminals run (P2-07).
- [x] **P1-11** · Native folder picker; path validation (`realpath`, exists, is a folder); detect Git repo + default branch · `S`
  - *2026-10-02:* `dialog:pickFolder` (modal to the calling window; `{ path: null }` on cancel). `src/main/fs/folders.ts` `resolveExistingFolder`: absolute only, `realpath` (true casing + junctions resolved, so the same folder can't be added twice), must be a folder, not a drive root. `src/main/git/detect.ts` reads `.git` files directly (no `git` process, so nothing from the repo's config runs): default branch = `origin/HEAD` target, else the checked-out branch; handles linked worktrees (`.git` file + `commondir`). Only a repo **root** is detected, not a subfolder of a repo. Verified end-to-end through `window.vcode` in the built app, including restart persistence. The real native dialog still needs a manual click-through (P1-12).
- [x] **P1-12** · Projects UI: sidebar list, create / edit / delete, empty state · `M`
  - *2026-10-02:* `src/renderer/src/features/projects/`: `ProjectsProvider` (list, selection, dialogs; plain React state, no query library), `ProjectList` (sidebar rows with a ⋯ menu: Rename / Archive·Restore / Remove; F2 renames and Delete removes the focused row; collapsible Archived group), `ProjectDialogs` (Add: folder picker → name pre-filled from the folder; Rename; Remove confirm that says files stay on disk). IPC errors are shown inline in dialogs, toasts (sonner) otherwise. Main area: project header (name, branch badge, path, Archived + Restore) or the first-project empty state. shadcn added: dialog, alert-dialog, input, label, dropdown-menu, sonner, badge (sonner pinned to dark; `next-themes` removed). Selection is not remembered across restarts yet (P1-13). Checked by driving the built app with real mouse/keyboard events and screenshots of every step.
- [x] **P1-13** · App settings store (`app_settings`) + window size/position persistence · `S`
  - *2026-10-03:* `src/main/settings/store.ts`: `readSetting` / `writeSetting` over `app_settings`; every read is checked against a zod schema and falls back to the default if the row is missing, isn't valid JSON or doesn't match (logged as a warning). Values are `JSON.stringify`'d by hand, because Drizzle's json mode writes `null` as SQL NULL and the column is NOT NULL. Renderer settings = `Settings` + `SETTING_DEFAULTS` in `shared/src/ipc/contracts.ts`, one row per key; `settings:get` returns all of them, `settings:set` takes a strict partial (unknown keys and empty patches rejected) and writes it in one transaction. First setting: `selectedProjectId` — `ProjectsProvider` restores it on launch (falls back to the first active project if it's gone) and saves every change. Window state (`src/main/window-state.ts`, key `window.main`, main-only): normal bounds + maximized, saved 500 ms after move/resize/maximize and on close; minimized and full-screen aren't saved. On launch the saved position is reused only if 120×40 px of the title bar is on some display's work area, otherwise the window is centred on the primary display with its size capped to the work area. Checked over 4 launches of the built app with a temp `userData` (24 checks): size/position/maximized restored, unmaximize returns to the saved size, an off-screen position comes back centred, the selected project is restored, a deleted one falls back, corrupt rows fall back to defaults, IPC validation.
- [x] **P1-14** · Logging with pino → `userData/logs` · `S`
  - *2026-10-03:* pino 10, `src/main/logging/`. `createLogger('module')` gives a child logger; the root exists from the first import (no outputs until `initLogging()`), and the file doesn't import electron, so logging modules stay unit-testable. No pino transports (worker threads complicate bundling/packaging): a `multistream` with a **sync** file stream (the last lines before a crash aren't lost) plus, in dev, a readable one-line console stream in local time. Files: `app.getPath('logs')/main-YYYY-MM-DD.log` (= `userData/logs` on Windows, `~/Library/Logs/Vcode` on macOS), JSON lines with UTC ISO times; files older than 14 days are deleted at startup. Level: `info` packaged, `debug` in dev, `VCODE_LOG_LEVEL` overrides. Basic redaction of `apiKey` / `api_key` / `token` / `password` / `secret` / `authorization` keys (top level and one object down); pattern-based scrubbing is P4-06. Logged: startup (version, Electron, OS, log file), quit, uncaught exceptions (monitor only, Electron's default handling still runs), unhandled rejections, renderer + child process crashes, renderer console warnings/errors (now in packaged builds too), and everything that used `console.*` (IPC sender rejections and handler failures, DB open failure, settings fallbacks, window-state save errors). If the log folder can't be created the app still starts. Checked in the built app: old file pruned, other files kept, renderer error + settings warning in both the file and the dev terminal.
- [x] **P1-15** · Vitest + unit tests: platform layer (port the P1-07 manual checks: PATHEXT resolution, cmd.exe argument round-trip, tree kill, registry env merge), path validation, projects service, DB (migrations, FK cascades — better-sqlite3 runs in plain Node), `isSafeExternalUrl`, IPC registry (sender check, request/response validation) · `M`
  - *2026-10-03:* Vitest 5 (runs on the existing Vite 7), one root `vitest.config.ts` for `apps/desktop/src/main/**/*.test.ts` + `packages/*/src/**/*.test.ts`, plain Node (`pnpm test`, `pnpm test:watch`). Tests sit next to the code; `src/main/testing.ts` gives temp folders and a freshly migrated temp DB per test. Modules that import `electron` are tested with `vi.mock('electron')`. **120 tests** (+4 macOS-only, skipped on Windows): DB (all V1 tables, WAL/FK/busy_timeout pragmas, reopen, corrupt file, every cascade / set-null rule, unique indexes), projects service (slugify, default name, Git branch, unique slugs, duplicate folder also through a junction, sort order, rename/archive/delete, NOT_FOUND), folder validation, Git detection (origin/HEAD, detached, worktree `commondir`, relative `gitdir`), settings store, logging (file, levels, early child loggers, redaction, error stacks, pruning), `isSafeExternalUrl`, IPC registry (sender checks, request validation, response stripping, error mapping, missing handlers, event validation), shared contracts, platform layer (PATH/PATHEXT order and filtering, `.ps1` only by path, current folder never searched, app execution alias, **30 tricky arguments** round-tripped through an npm-style `.cmd` shim, `.cmd` path with spaces and `&`, tree kill of parent + grandchild, registry env). `mergeEnvironment` was pulled out of `win32.loadUserEnvironment` so its rules are tested directly. When `vi.resetModules()` reloads a module, take `IpcError` from the reloaded `@vcode/shared` too, or `instanceof` fails. The macOS tests first run in CI (P1-16).
- [x] **P1-16** · GitHub Actions on `windows-latest` + `macos-latest`: lint, typecheck, unit tests · `S`
  - *2026-10-03:* `.github/workflows/ci.yml`: push to `main`, pull requests and manual runs; matrix `windows-latest` + `macos-latest` (`fail-fast: false`), Node 24, pnpm from `packageManager`, pnpm store cached; steps: `pnpm install --frozen-lockfile` → `format:check` → `lint` → `typecheck` → `test`. `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (tests don't need Electron). Older runs of the same ref are cancelled. ~1 min per OS. First green run: [37122680987](https://github.com/lahiru321/Vcode/actions/runs/37122680987); the macOS-only platform tests passed there on their first run. Fixed on the way: `pnpm install` failed on the Windows runner because pnpm ran an implicit `node-gyp rebuild` for better-sqlite3 (it has a `binding.gyp` and no install script) — now `pnpm.neverBuiltDependencies: ["better-sqlite3"]`, see P1-09. Known warning: `pnpm/action-setup@v4` targets the deprecated Node 20 Actions runtime (GitHub runs it on Node 24 for now); bump when a newer major is out. `gh` isn't logged in yet; the repo is public, so run results can be read without it.

**Done when:**
- `pnpm dev` opens the app window.
- A project added from a folder is still there after restarting the app.
- CI is green on Windows and macOS.

---

## P2 — Terminal Engine

**Goal:** a plain PowerShell terminal works inside the app and survives a UI reload.
**Depends on:** P1.

- [x] **P2-01** · PTY host as an Electron `utilityProcess`; main starts it and restarts it if it dies · `M`
  - *2026-10-03:* Entry `src/pty-host/index.ts`, built as a second main input → `out/main/pty-host.js`, forked with `utilityProcess.fork` (`serviceName` "Vcode PTY Host" — shows as the process **name** in `app.getAppMetrics()`; `stdio: 'pipe'`, each stdout/stderr line logged). Protocol in `src/pty-host/protocol.ts`: main → host `request {id, method, params}` / `shutdown`; host → main `ready {pid}`, `response {id, ok, result | error}`, `log {level, msg, data}` (host records go to the main log file). Main validates every host message with zod (a plain `z.union` — zod 4's `discriminatedUnion` refuses two variants with the same `kind`). First method: `ping`; P2-02 adds spawn / write / resize / kill. `src/main/pty-host/supervisor.ts` (`PtyHostSupervisor`, Electron only via an injected `fork`, so it's unit-tested with a fake process + fake timers): states idle → starting → ready → restarting / stopping → stopped / failed; ready timeout 10 s (then killed and counted as a crash); restart delays 250 ms, 1 s, 2 s, 5 s…; **5 crashes within 60 s → `failed`**, no more restarts, and an `app:notice` error toast ("Terminals are unavailable…"); pending requests are rejected when the host exits; `exit` event carries `{ code, expected }` for P2-08. Quit: `before-quit` waits for `ptyHost.stop()` (sends `shutdown`, kills after 3 s). Renderer: new `AppNotices` shows `app:notice` events as toasts (nothing listened before). node-pty 1.1.0 added now (see P1-09). Checked in the built app: host running, killed from outside → restarted with a new PID, crash loop → gives up + toast, normal quit → host logs "shutting down", exits 0, app closes in ~1.5 s. 24 new unit tests (supervisor + host entry).
- [x] **P2-02** · Spawn terminals with node-pty using `platform.defaultShell()`; record `terminal_sessions` rows · `M`
  - *2026-10-03:* IPC `terminals:create { projectId, workspaceId?, cols, rows, title? }` and `terminals:list { projectId }` (no UI until P2-04). `src/main/terminals/service.ts`: project must exist and not be archived (`CONFLICT`); without `workspaceId` the project's `main` workspace is used (created on first use — the minimal part of P3-04); its folder is checked with `resolveExistingFolder` before anything starts; shell = `platform.defaultShell()` + `shellArgs()` via `buildCommand` (pre-quoted Windows command lines are passed to node-pty as one string). Row inserted as `starting` → `running` with the PID once the host has spawned it; spawn failure → `failed` and `INTERNAL` with the host's message, host not running → `UNAVAILABLE` (new IPC error code; `PtyHostError` now has a `reason`). Exits: `exited` + exit code; exits during host shutdown → `stopped`. Environment (`terminals/environment.ts`): the user's registry environment, read once at startup and cached (falls back to the app's own), minus `ELECTRON_*`, plus `TERM_PROGRAM=Vcode`, `TERM_PROGRAM_VERSION`, `COLORTERM=truecolor`. Host (`src/pty-host/terminals.ts`, `TerminalManager`): node-pty sessions keyed by session id, methods `spawn` / `write` / `resize` / `kill` / `output` / `list`, an `exit` message per ended process, the last 256 kB of output kept per terminal (until P2-03/P2-06), and shutdown closes every terminal (2 s grace) before exiting. Found while checking in the built app: a shell **outlives a crashed host** — main now kills the process tree of every session the host leaves behind. Checked in the built app: PowerShell started in the project folder as a child of the host, list, size validation, shell killed → `exited`, host killed → `failed` and its shell gone, new terminal after the host restart, quit → `stopped` and no shell left. Tests: manager with a fake pty and with **real node-pty** (PowerShell / `sh`: input → output, env var, `exit 3`), service with a real DB and fake host, environment. Tests may now branch on `process.platform` (lint rule relaxed for `*.test.ts`).
  - *2026-10-03:* macOS CI found that node-pty 1.1.0 is **published with `prebuilds/darwin-*/spawn-helper` not executable** (mode 644 in the npm tarball), so every terminal fails on macOS with `posix_spawnp failed`. Root `postinstall` → `scripts/fix-node-pty.mjs` sets it to 755 (install time, not runtime: a signed app bundle is read-only; P8 packaging copies the mode). Drop it once a node-pty release ships the right mode.
- [x] **P2-03** · MessagePort wiring renderer ⇄ PTY host: output, input, resize · `M`
  - *2026-10-03:* `terminals:attach { terminalId }` (running terminals only, else `CONFLICT`): main creates a `MessageChannelMain`, sends one end to the PTY host with an `attach` request (`supervisor.request(..., { transfer })`) and the other to the **calling** window with `webContents.postMessage('terminal:port', …)`. Ports can't cross the context bridge, so the preload hands it to the page with `window.postMessage` (the page accepts it only from its own window with `source: 'vcode:terminal-port'`; `lib/terminal-port.ts` `openTerminalPort()`, 10 s timeout). Port messages (`@vcode/shared/terminal-port`, zod-free so the host bundle stays small): host → renderer `data` / `exit`, renderer → host `input` (≤ 1 MB, bigger pastes are split) / `resize` (2–1000 × 1–500). The host treats the renderer as untrusted: `parseTerminalClientMessage` drops anything else. On attach the host replays its buffered output, then streams; one connection per terminal — attaching again (UI reload) replaces it; a renderer-closed port is forgotten and output keeps buffering; on exit the host sends `exit` and closes the port. The preload is now typechecked by `tsconfig.web.json` only (it runs in the page). Found by tests: a failed host request without ports crashed the error path (ports now default to `[]`).
- [x] **P2-04** · xterm.js terminal component + fit / search / web-links / WebGL add-ons · `M`
  - *2026-10-03:* xterm.js 6 + fit 0.11 / search 0.16 / web-links 0.12 / webgl 0.19. `features/terminals/TerminalView.tsx`: dark theme matching the app, Cascadia Mono → Consolas → SF Mono/Menlo, 5000 lines scrollback, WebGL with fallback to the DOM renderer on context loss; links go through `window.open` → main's confirm dialog (http/https only). Fit on every container resize (ResizeObserver + rAF) and when a tab becomes active; the PTY gets a `resize` only when cols/rows change. On exit: dimmed "[Process exited with code N]" and the cursor is hidden. `useProjectTerminals` + `TerminalTabs`: the header's **New terminal** button (disabled for archived projects) and a `+` in the tab bar; one tab per terminal (title, green/grey dot), inactive views stay mounted (hidden) so their state is kept; on opening a project its running terminals are re-attached. Search UI comes with the toolbar (P5-04), the grid with P5-01, closing tabs with P2-07. Also fixed: a long folder path squeezed the project name in the header. Checked in the built app with real clicks and keystrokes: New terminal → PowerShell in the project folder; typed command ran (`TERM_PROGRAM=Vcode` set); PTY width followed the view (129 cols) and the window (→ 86); UI reload kept the same process, replayed output and still took input; `+` → second terminal, tab switching; `exit 4` → tab ended, exit code 4 recorded.
- [x] **P2-05** · Output batching (~16 ms) + back-pressure so a noisy process can't freeze the UI · `S`
  - *2026-10-09:* Host (`TerminalManager`): output for an attached renderer is collected and sent as one `data` message at most every 16 ms (`OUTPUT_BATCH_MS`); the last batch is flushed before `exit`. Flow control by characters: the renderer acks each `data` message once xterm has drawn it (`write` callback → new port message `ack { chars }`, validated like the others); sent-but-unacked + waiting output above **100 000** → `pty.pause()`, below **5 000** → `pty.resume()` (VS Code's values). The attach replay counts as unacked; with no renderer attached nothing is paused (output keeps going to the buffer), and a renderer going away resumes a paused process. Tests: batching, pause/resume thresholds, replay, detach (fake pty), and a **real shell** printing 20 000 lines that pauses with no acks, then finishes once acked. Also fixed today: a second attach to the same terminal (React StrictMode mounts views twice in dev) got the first, already-replaced port, so typing did nothing — attaches now carry an `attachId`; and sessions left `starting`/`running` by an earlier run are marked `failed` at launch (killing their processes stays with P2-09).
- [x] **P2-06** · `@xterm/headless` mirror + serialize add-on; `terminals:attach` replays the screen after a reload · `M`
  - *2026-10-09:* `@xterm/headless` 6 + `@xterm/addon-serialize` 0.14 in the PTY host (`src/pty-host/mirror.ts`, `ScreenMirror`): every terminal's output goes through a headless xterm (same size as the PTY — resizes go to both — and the same 5000-line scrollback as the view, `TERMINAL_SCROLLBACK`). Replaces the 256 kB raw-output buffer. On attach the host waits until the mirror has parsed everything so far, then sends the serialized screen (colours, cursor, alternate screen, scrollback) as the first `data` message; output arriving meanwhile waits behind it, and an exit during attach is sent after the screen. The screen counts as unacked output (P2-05). The host's `output` method now returns the serialized screen. Tests (fake pty): screen not raw output (cleared text is gone), resize wraps the mirror, screen then new output, output held back during attach, replaced attach mid-replay, exit during attach.
- [x] **P2-07** · Stop / restart / close; stop calls `platform.killProcessTree()` · `M`
  - *2026-10-09:* IPC `terminals:stop` / `terminals:restart` / `terminals:close { terminalId }` (spec §20 names). Stop ends the session's **whole process tree** with `platform.killProcessTree(pid)` (taskkill /T /F; process group on macOS) and records `stopped` — the exit the host reports afterwards (or during the kill) keeps `stopped`; a terminal that already ended is returned as is; still `starting` (no PID) → `CONFLICT`; a failed kill → `INTERNAL` and the terminal stays running. Restart = stop if running, then a **new** session (new id) with the same workspace, title and size. Close = stop if running; the row stays as history. UI: each tab has a close ×, middle-click closes, and the tab bar has Restart and Stop (disabled once ended) for the active terminal; restart replaces the tab in place, close activates the right-hand neighbour. Tests: stop (+ exit after / during the kill), already ended, failed kill, starting, restart running / ended, close, unknown id. `terminals:rename` comes with the toolbar (P5-04).
- [x] **P2-08** · PTY host crash recovery: affected sessions marked `FAILED` · `S`
  - *2026-10-03:* Done with P2-02: on an unexpected host exit, every session started by this run that hasn't ended is marked `failed` and its process tree is killed (shells outlive the host otherwise); the host restarts (P2-01) and new terminals work. Rows left `running` by an earlier crashed run are left for P2-09. The terminal panel showing the failure comes with P2-04.
- [x] **P2-09** · Orphan cleanup on launch: check stored PIDs (PID + process name + start time) and kill leftovers · `M`
  - *2026-10-09:* At launch, before the UI can list terminals, sessions still `starting`/`running` from an earlier run are marked `failed` (`failStaleSessions`). Then, in the background (`terminals/orphans.ts`), their PIDs are looked up with the new `platform.processInfo(pids)` — Windows: one `Get-CimInstance Win32_Process` query (name + `CreationDate`); macOS: `ps -o pid=,lstart=,comm=` in the C locale (whole seconds; login shells' leading `-` stripped) — and a process is ended (`killProcessTree`) **only if** its executable name matches the session's `shell` and it started between 2 s before and 60 s after the session's `started_at`, so a reused PID is never touched. No schema change: the name comes from `shell` (P3 agent sessions may need the spawned file stored). Results go to the log. Tests: matching rules (name case, `-zsh`, reused PID, wrong start time), kill only matches, no PIDs, failed kill, a **real** leftover Node process ended, and `processInfo` against real processes.
- [x] **P2-10** · Terminal safety: confirm before opening links; block OSC 52 clipboard writes · `S`
  - *2026-10-09:* Detected URLs already went through `window.open` → main's "Open this link in your browser?" (http/https only, P1/P2-04). Now **OSC 8 hyperlinks** (link text can differ from the target) use the same path via xterm's `linkHandler` (`allowNonHttpProtocols: false`) instead of xterm's built-in prompt; the dialog shows the real URL. **OSC 52** (clipboard write/read) is swallowed by a parser handler (`features/terminals/safety.ts`) — xterm.js ignores it without the clipboard add-on, and this keeps it blocked if one is ever loaded. Renderer tests (DOM-free) now run in vitest; checked against `@xterm/headless`: OSC 52 never reaches another handler (BEL and ST forms), other OSC sequences still work, link handler passes the real target.
- [x] **P2-11** · Integration test: spawn shell, echo text, kill the process tree · `M`
  - *2026-10-09:* `src/main/terminals/integration.test.ts`: a real shell (Windows PowerShell / `sh`) in the PTY host's `TerminalManager` with real node-pty, a renderer stand-in on the port that acks output like `TerminalView`, typed input → computed output (`e2e-42`), then the shell starts a long-running Node child that prints its PID; the real `platform.killProcessTree` (what `terminals:stop` calls) ends the tree → the exit reaches main and the renderer, and the child is gone. Electron itself (utilityProcess, MessageChannelMain, the window) is covered by the manual **Done when** checks below until P7's E2E smoke tests.

**Done when:**
- You can type commands in a PowerShell terminal and see live output.
- Reloading the UI (Ctrl+R) keeps the terminal screen and the process.
- Stopping a terminal also kills its child processes.
- Quitting the app leaves no orphaned processes (check Task Manager).

---

## P3 — First CLI Agent (Claude Code)

**Goal:** Claude Code runs end-to-end inside the app.
**Depends on:** P2.

- [x] **P3-01** · `AgentAdapter` interface in `packages/adapters` (`validate`, `prepareEnvironment`, `buildCommand`, `start`, `stop`, `getStatus`, `cleanup`) · `S`
  - *2026-10-09:* `packages/adapters/src/types.ts`. The package has no Node/Electron imports: main passes an `AdapterContext` = the platform layer's `resolveExecutable` / `buildCommand` (same shapes, declared again) + `run` (runs a command to completion, never throws; `src/main/agents/run.ts`, `execFile` with `windowsVerbatimArguments` and a timeout). Processes stay with main and the PTY host, so the process hooks are narrow: `start(session)` after the spawn, `stop(session)` (default: `session.killTree()`), `cleanup(session)` after it ended, and `getStatus(current, signal)` maps terminal signals (`output` / `idle` / `bell`) to `ready` / `working` / `waiting` (used by P3-06). `CliAdapter` base class: executable = the configured one or `defaultExecutable` on PATH; validate = `--version` (15 s) → `ready` + parsed version / `not_found` / `error` with the first output line; `buildCommand` = `launchArgs(config)` + the user's args, throws `AdapterError('not_found')`; default activity rules (start-up output ignored, first idle → `ready`, output → `working`, idle/bell after work → `waiting`). `getAdapter(id)` registry.
- [x] **P3-02** · `ClaudeAdapter`: find the executable (`.exe` / `.cmd` shim via `resolveExecutable`), validate with `--version`, build the command · `M`
  - *2026-10-09:* `packages/adapters/src/claude.ts`: `claude` on PATH; `model` → `--model`, role + instructions → `--append-system-prompt`; drops `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` from the environment (a Claude started from inside Claude Code would think it's nested). No credentials: Claude Code's own login. Tests: unit (fake context) + real platform layer through an npm-style `.cmd` shim / `sh` script. Checked on this machine: the native install `~\.local\bin\claude.exe` resolves and validates as 2.1.294.
- [ ] **P3-03** · Agents service + IPC (minimal create / list) · `S`
- [ ] **P3-04** · Default `main` workspace created with each project; agents launch there · `S`
  - *2026-10-03:* The `main` workspace (kind `main`, path = project root, name `main`) is already created on first use by P2-02 (`ensureMainWorkspace`, `src/main/workspaces/service.ts`). Left for P3-04: agents launching there.
- [ ] **P3-05** · `agent_sessions` lifecycle + status (`CREATED → STARTING → READY → … → STOPPED / FAILED`) · `M`
- [ ] **P3-06** · Best-effort `READY` / `WORKING` / `WAITING` detection (output idle timeout, terminal bell) · `M`
- [ ] **P3-07** · "Start Claude Code" button per project + status badge · `S`

**Done when:**
- Claude Code starts inside the app in the project folder.
- Claude Code's own login flow works (no credential handling by the app).
- You can chat with it and it edits files in the project.

---

## P4 — Agent Registry

**Goal:** configure any supported CLI; store API keys safely.
**Depends on:** P3.

- [ ] **P4-01** · Add Agent dialog: provider, name, global or project scope, executable auto-detect + override, args, model, role / instructions · `M`
- [ ] **P4-02** · Agents manager UI: list, edit, delete, validate · `M`
- [ ] **P4-03** · `GeminiAdapter` + `CodexAdapter` · `M`
- [ ] **P4-04** · `CustomCLIAdapter` (any command the user enters) · `S`
- [ ] **P4-05** · Credentials: encrypt with `safeStorage`, metadata-only UI, inject as env vars at launch · `M`
- [ ] **P4-06** · Redact recognizable secrets from logs · `S`
- [ ] **P4-07** · Tests: adapter `buildCommand` output; secrets never appear in IPC responses · `M`

**Done when:**
- Claude Code, Gemini CLI, Codex CLI and one custom CLI can all be configured and launched.
- API keys are stored encrypted and never reach the renderer.
- Adding a new adapter needs no UI changes.

---

## P5 — Multi-Terminal Workspace

**Goal:** many agents side by side in a flexible, saved layout.
**Depends on:** P2, P4.

- [ ] **P5-01** · dockview grid for terminal panels · `M`
- [ ] **P5-02** · Add Terminal dialog: project → workspace → agent or plain shell · `M`
- [ ] **P5-03** · Panel controls: close, maximize / restore, rename, rearrange, split · `M`
- [ ] **P5-04** · Terminal toolbar: copy, paste, search, clear, stop, restart (needs clipboard access: all browser permissions are denied since P1-05, so allow clipboard for the app only or route it through IPC) · `S`
- [ ] **P5-05** · Save the layout per project (`projects.layout_json`) and restore it on launch · `M`
- [ ] **P5-06** · Keyboard shortcuts (new terminal, close, maximize, next / previous panel) with `CommandOrControl` · `S`
- [ ] **P5-07** · Status indicators on each panel and in the sidebar agent list · `S`

**Done when:**
- 4+ agents run at the same time in one project.
- The layout comes back after restarting the app.
- Stopping one terminal doesn't affect the others.

---

## P6 — Workspace & Git

**Goal:** each agent works in its own folder or Git worktree.
**Depends on:** P1, P3.

- [ ] **P6-01** · Repository link / detection: remote URL, local path, default branch · `S`
- [ ] **P6-02** · Workspace manager UI: list, create, delete · `M`
- [ ] **P6-03** · Folder workspaces · `S`
- [ ] **P6-04** · Git worktree workspaces: create branch + worktree under `workspaces/`, remove safely (warn on uncommitted changes) · `L`
- [ ] **P6-05** · Path guards: every workspace must resolve inside the project root (no symlink escapes) · `S`
- [ ] **P6-06** · Branch name + uncommitted-changes indicator per workspace in the sidebar · `M`
- [ ] **P6-07** · Reveal in Explorer / Open in VS Code · `S`

**Done when:**
- Each agent can run in its own worktree on its own branch.
- Deleting a workspace removes its worktree cleanly.
- A workspace path outside the project root is rejected.

---

## P7 — Desktop Polish & Hardening

**Goal:** feels like a real desktop app and passes the security checklist.
**Depends on:** P5.

- [ ] **P7-01** · System tray with running-agent count (Show / Hide, New Terminal, Quit) · `S`
- [ ] **P7-02** · Close window → hide to tray (setting); quit with running agents → confirmation listing them · `S`
- [ ] **P7-03** · Native notifications when an agent finishes or seems to be waiting for input · `S`
- [ ] **P7-04** · Single-instance lock (second launch focuses the existing window) · `S`
- [ ] **P7-05** · Audit log service + simple viewer (terminal start/stop, agent changes, credential changes, workspace operations) · `M`
- [ ] **P7-06** · Security checklist review (V1 doc §21) + Electron fuses · `S`
- [ ] **P7-07** · Setting for the maximum number of concurrent terminals · `S`
- [ ] **P7-08** · End-to-end smoke tests with Playwright for Electron · `M`

**Done when:**
- Tray, close-to-tray, quit confirmation and notifications all work.
- Every item in the V1 security checklist is checked off.
- E2E smoke tests pass in CI.

---

## P8 — Distribution

**Goal:** a signed Windows installer that updates itself.
**Depends on:** P7.

- [ ] **P8-01** · electron-builder config: NSIS installer, Windows x64 · `M`
- [ ] **P8-02** · App icon, product name, version, About dialog · `S`
- [ ] **P8-03** · Authenticode code signing (needs the certificate decision below) · `S`
- [ ] **P8-04** · Auto-update with electron-updater + GitHub Releases · `M`
- [ ] **P8-05** · Opt-in crash reporting · `S`
- [ ] **P8-06** · Release workflow: pushing a version tag builds and publishes the installer · `M`
- [ ] **P8-07** · Install test on a clean Windows machine / VM · `S`

**Done when:**
- All 18 V1 acceptance criteria (see the coverage table below) pass on a clean Windows machine.

---

## After V1 — macOS Release

**Goal:** the same app on macOS, from the same codebase.
**Depends on:** P8.

- [ ] **M-01** · Real `darwin.ts`: user's `$SHELL`, login-shell PATH loading, process-group termination · `M`
- [ ] **M-02** · Verify Cmd shortcuts, app menu, Dock and window-close behavior · `S`
- [ ] **M-03** · Universal build (x64 + arm64) incl. native modules · `M`
- [ ] **M-04** · DMG packaging; Developer ID signing + notarization · `M`
- [ ] **M-05** · macOS auto-update feed · `S`
- [ ] **M-06** · Run the full acceptance checklist on macOS · `S`

---

## V2+ outline (expand into tasks after V1)

From the Vibe Coding Plan (§20 roadmap):

1. **Multi-agent:** tasks, dependencies, workflow DAG, orchestration, agent-to-agent handoffs
2. **Verification:** build/test runner, Monaco diff view, code review agent, Playwright browser checks, approval gates
3. **Intelligence:** code indexing (SQLite FTS5 + sqlite-vec), project memory, automatic context selection
4. **Usage & budgets:** token tracking, cost estimates, budget limits
5. **Team mode:** optional cloud sync service, accounts, RBAC, shared agents

---

## Open decisions

| Decision | Needed by | Status |
|---|---|---|
| Final app name | P8-02 | Decided 2026-10-02: **Vcode** |
| Code-signing certificate (Authenticode; Apple Developer ID later) | P8-03 | Open |
| GitHub repo location + public / private | P1-16 | Decided 2026-10-03: **github.com/lahiru321/Vcode**, public |
| License | P8 | Open |

---

## Appendix — V1 acceptance criteria coverage

Maps each criterion in V1 doc §24 to the tasks that deliver it.

| # | Criterion (short) | Tasks |
|---|---|---|
| 1 | Single Windows installer, no extra runtimes | P8-01, P8-07 |
| 2 | Create project from a folder / Git repo | P1-10, P1-11, P1-12 |
| 3 | Configure at least one CLI agent | P3-03, P4-01 |
| 4 | Launch agent inside a workspace | P3-04, P5-02 |
| 5 | Live terminal output | P2-03, P2-04 |
| 6 | Keyboard input reaches the real CLI | P2-03 |
| 7 | Multiple sessions at once | P5-01 |
| 8 | Add / close terminals independently | P5-02, P5-03 |
| 9 | Resize / maximize / restore; layout persists | P5-03, P5-05 |
| 10 | Stop one terminal without affecting others; whole tree ends | P2-07 |
| 11 | Status visible in app and tray | P3-05, P3-06, P5-07, P7-01 |
| 12 | UI reload restores screens without restarting processes | P2-06 |
| 13 | Close → tray; quit asks if agents are running | P7-02 |
| 14 | Workspace paths validated | P1-11, P6-05 |
| 15 | Credentials encrypted, never in renderer | P4-05, P4-07 |
| 16 | No orphaned processes after quit or crash | P2-07, P2-09 |
| 17 | New adapters without UI rewrite | P3-01, P4-04 |
| 18 | No OS-specific code outside platform layer; macOS CI passes | P1-07, P1-16 |

---

## Changelog

- **2026-10-02** — Roadmap created from spec v1.1 (Desktop Edition).
- **2026-10-02** — Specs moved to `docs/`. TypeScript pinned to 6.0.x until typescript-eslint supports TS 7 (revisit later).
- **2026-10-02** — App renamed **AI Agent Hub → Vcode** (product name, window title, `%APPDATA%\Vcode\vcode.db`, `@vcode/*` packages, `window.vcode` bridge). The spec documents keep their original names. GitHub: https://github.com/lahiru321/Vcode
- **2026-10-03** — **P1 Foundation done** (P1-13 … P1-16). All three Done-when checks pass: the app window opens, projects persist across restarts, CI is green on Windows and macOS. P1-09 note corrected (better-sqlite3 build scripts are now skipped).
- **2026-10-09** — **P2 Terminal Engine done** (P2-05 … P2-07, P2-09 … P2-11). Marked done by the owner after the Done-when checks (typing with live output, screen kept on Ctrl+R, Stop ends child processes, no orphans after quit). Also fixed on the way: typing into a terminal did nothing in dev (double attach under React StrictMode), and terminals left `running` by an earlier run could not be attached.
