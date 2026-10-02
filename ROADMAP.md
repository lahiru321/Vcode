# AI Agent Hub — Roadmap

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

**Current phase:** P1 — Foundation

**Next up:**
1. `P1-05` Electron security baseline
2. `P1-06` Typed IPC
3. `P1-07` Platform layer

---

## Phase overview

| # | Phase | Goal | Size | Status |
|---|---|---|---|---|
| P1 | Foundation | App opens, projects persist, CI green on Windows + macOS | L | To do |
| P2 | Terminal Engine | A real PowerShell terminal that survives a UI reload | L | To do |
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
- [ ] **P1-05** · Electron security baseline: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, block navigation and new windows · `S`
- [ ] **P1-06** · Typed IPC: zod contracts in `packages/shared`, preload exposes `window.agentHub`, main handler registry checks sender + validates payload · `M`
- [ ] **P1-07** · Platform layer: interface + `win32.ts` + `darwin.ts` stub (`defaultShell`, `resolveExecutable`, `killProcessTree`, `loadUserEnvironment`, `revealInFileManager`); lint rule banning `process.platform` elsewhere · `M`
- [ ] **P1-08** · SQLite + Drizzle: all V1 tables (V1 doc §8), migrations at startup, WAL + foreign keys on, DB file in `userData` · `M`
- [ ] **P1-09** · Native module rebuild for Electron (better-sqlite3 now, node-pty in P2) · `S`
- [ ] **P1-10** · Projects service + IPC: list / create / get / update / delete · `S`
- [ ] **P1-11** · Native folder picker; path validation (`realpath`, exists, is a folder); detect Git repo + default branch · `S`
- [ ] **P1-12** · Projects UI: sidebar list, create / edit / delete, empty state · `M`
- [ ] **P1-13** · App settings store (`app_settings`) + window size/position persistence · `S`
- [ ] **P1-14** · Logging with pino → `userData/logs` · `S`
- [ ] **P1-15** · Vitest + unit tests: platform layer, path validation, projects service · `M`
- [ ] **P1-16** · GitHub Actions on `windows-latest` + `macos-latest`: lint, typecheck, unit tests · `S`

**Done when:**
- `pnpm dev` opens the app window.
- A project added from a folder is still there after restarting the app.
- CI is green on Windows and macOS.

---

## P2 — Terminal Engine

**Goal:** a plain PowerShell terminal works inside the app and survives a UI reload.
**Depends on:** P1.

- [ ] **P2-01** · PTY host as an Electron `utilityProcess`; main starts it and restarts it if it dies · `M`
- [ ] **P2-02** · Spawn terminals with node-pty using `platform.defaultShell()`; record `terminal_sessions` rows · `M`
- [ ] **P2-03** · MessagePort wiring renderer ⇄ PTY host: output, input, resize · `M`
- [ ] **P2-04** · xterm.js terminal component + fit / search / web-links / WebGL add-ons · `M`
- [ ] **P2-05** · Output batching (~16 ms) + back-pressure so a noisy process can't freeze the UI · `S`
- [ ] **P2-06** · `@xterm/headless` mirror + serialize add-on; `terminals:attach` replays the screen after a reload · `M`
- [ ] **P2-07** · Stop / restart / close; stop calls `platform.killProcessTree()` · `M`
- [ ] **P2-08** · PTY host crash recovery: affected sessions marked `FAILED` · `S`
- [ ] **P2-09** · Orphan cleanup on launch: check stored PIDs (PID + process name + start time) and kill leftovers · `M`
- [ ] **P2-10** · Terminal safety: confirm before opening links; block OSC 52 clipboard writes · `S`
- [ ] **P2-11** · Integration test: spawn shell, echo text, kill the process tree · `M`

**Done when:**
- You can type commands in a PowerShell terminal and see live output.
- Reloading the UI (Ctrl+R) keeps the terminal screen and the process.
- Stopping a terminal also kills its child processes.
- Quitting the app leaves no orphaned processes (check Task Manager).

---

## P3 — First CLI Agent (Claude Code)

**Goal:** Claude Code runs end-to-end inside the app.
**Depends on:** P2.

- [ ] **P3-01** · `AgentAdapter` interface in `packages/adapters` (`validate`, `prepareEnvironment`, `buildCommand`, `start`, `stop`, `getStatus`, `cleanup`) · `S`
- [ ] **P3-02** · `ClaudeAdapter`: find the executable (`.exe` / `.cmd` shim via `resolveExecutable`), validate with `--version`, build the command · `M`
- [ ] **P3-03** · Agents service + IPC (minimal create / list) · `S`
- [ ] **P3-04** · Default `main` workspace created with each project; agents launch there · `S`
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
- [ ] **P5-04** · Terminal toolbar: copy, paste, search, clear, stop, restart · `S`
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
| Final app name | P8-02 | Open (working name: AI Agent Hub) |
| Code-signing certificate (Authenticode; Apple Developer ID later) | P8-03 | Open |
| GitHub repo location + public / private | P1-16 | Open |
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
