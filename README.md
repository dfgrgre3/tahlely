# Tahlely — Desktop AI Engineering Platform

Production-grade desktop platform for project analysis, AI code review, and
permission-controlled engineering agents. This repository currently contains the
**Prompt 1 foundation**: modular architecture, domain contracts, application
services, security boundaries, persistence, analysis/AI/agent abstractions, and
the desktop shell.

## Quickstart

```powershell
npm install
npm test            # unit + integration tests
npm run typecheck   # strict TypeScript
npm run lint        # eslint, zero warnings
npm run dev         # Vite dev server for the desktop frontend
npm run build       # production frontend build
```

Desktop (Tauri) shell lives in `apps/desktop/src-tauri`:

```powershell
npm run tauri --workspace @tahlely/desktop -- dev
```

## Structure

```text
apps/desktop/          Tauri + React shell (UI only; no business logic in views)
packages/domain/       Framework-free domain entities and contracts
packages/application/  Use cases, ports, typed event bus, background task manager
packages/infrastructure/ Adapters: filesystem, discovery, indexing, logging, config, cache
packages/analysis/     Analyzer contracts, engine, profiles, built-in analyzers
packages/ai/           Provider-agnostic AI gateway (mock + OpenAI-compatible)
packages/agents/       Agent definitions and permission-checked run orchestration
packages/security/     Permissions, policy engine, path guard, secret redaction
packages/execution/    Controlled command execution (allowlist, timeout, cancel, audit)
packages/reporting/    Report builders (markdown / html / json / csv / sarif)
packages/persistence/  Repository implementations (JSON-file now, SQLite target)
tests/contract/        Architecture boundary tests (layering enforcement)
docs/                  Architecture docs + ADRs
```

## Layering rules (enforced by `tests/contract/boundaries.test.ts`)

```text
ui (apps/desktop) → application → domain
infrastructure → application ports + domain
analysis/ai/agents/security/execution/reporting/persistence → domain (+ application ports)
domain → nothing (framework-free, dependency-free)
```

- Presentation code never touches the filesystem, shell, or network directly.
- AI output never executes: every sensitive action passes through the
  permission engine and the execution layer with an audit event.
- See `docs/architecture.md` and `docs/adr/` for decisions and rationale.
