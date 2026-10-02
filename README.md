# AI Agent Hub

Desktop app (Windows first, macOS later) for running and managing multiple AI coding CLIs — Claude Code, Gemini CLI, Codex CLI — side by side.

- **Specs:** [`docs/`](docs/) — V1 technical spec and the long-term platform plan
- **Progress:** [`ROADMAP.md`](ROADMAP.md)

## Requirements

- Node.js 22+ (24 LTS recommended)
- pnpm 9 (`corepack enable` picks the pinned version)
- Git
- Windows: Visual Studio Build Tools with the C++ workload (for native modules)

## Repository layout

```
apps/desktop/        Electron app (main, preload, renderer; pty-host added in P2)
packages/shared/     IPC contracts, schemas and shared types
packages/adapters/   CLI agent adapters
docs/                Product and architecture specs
```

## Commands

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `pnpm install`      | Install all workspace dependencies  |
| `pnpm dev`          | Run the desktop app with hot reload |
| `pnpm build`        | Production build into `apps/desktop/out` |
| `pnpm lint`         | ESLint across the repo              |
| `pnpm typecheck`    | TypeScript check in every package   |
| `pnpm format`       | Format with Prettier                |
| `pnpm format:check` | Check formatting without writing    |
