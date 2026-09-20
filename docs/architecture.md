# Architecture — Tahlely Desktop AI Engineering Platform (v0.1.0, Prompt 1)

## 1. Product vision

Tahlely is a desktop engineering platform that turns any local project into an
analyzable, conversable, agent-operable workspace — with deterministic analysis
where possible, AI reasoning where required, and explicit human approval for
every sensitive action. Prompt 1 establishes the load-bearing foundation:
module boundaries, domain contracts, security gates, persistence, and the
desktop shell. Later phases extend — never rewrite — these contracts.

## 2. System overview

```text
User
 ↓
Desktop Application (Tauri webview + React)
 ↓
Workspace Manager (projects, conversations, selection)
 ↓
Project Intelligence (discovery → index → dependency signals)
 ↓
Analysis Engine (profiles → analyzers → findings)
 ↓
AI Context / Retrieval Layer (budgeted, redacted context)
 ↓
Agent Orchestrator (AgentService, permission-gated tools)
 ↓
Permission / Policy Engine (allow · require-approval · deny)
 ↓
Execution / Sandbox Layer (allowlisted, shell-free, audited)
 ↓
Project Files
```

AI output never touches the OS. Reads flow down the left side; every mutation
flows through permission evaluation, an explicit approval, execution, and an
audit event.

## 3. Module boundaries

| Module         | Package                   | Responsibility                                         |
| -------------- | ------------------------- | ------------------------------------------------------ |
| Domain         | `packages/domain`         | Framework-free entities & contracts (zero deps)        |
| Application    | `packages/application`    | Use cases, ports, EventBus, TaskManager                |
| Infrastructure | `packages/infrastructure` | FS adapters, discovery, indexer, logger, config, cache |
| Analysis       | `packages/analysis`       | Analyzer contract, engine, profiles, built-ins         |
| AI gateway     | `packages/ai`             | Provider abstraction, registry, context builder        |
| Agents         | `packages/agents`         | Agent templates, permission-gated run service          |
| Security       | `packages/security`       | Permissions, path guard, policy, redaction             |
| Execution      | `packages/execution`      | Allowlisted, shell-free command runner                 |
| Reporting      | `packages/reporting`      | Report assembly + md/html/json/csv/sarif               |
| Persistence    | `packages/persistence`    | Repository impls (JSON-file now, SQLite target)        |
| Desktop shell  | `apps/desktop`            | Tauri + React UI (presentation only)                   |

Dependency direction (enforced by `tests/contract/boundaries.test.ts`):

```text
desktop → {application, infrastructure, analysis, ai, agents, security, execution, reporting, persistence, domain}
agents → {application, ai, security, domain}
execution → {application, security, domain}
infrastructure → {application, security, domain}
analysis → {application, domain}
ai → {security, domain}
application → {domain}
persistence → {application, domain}
domain → {}
```

Additionally, browser-safe barrels must not import `node:` modules
(`./node` subpaths hold Node-only adapters), and no package imports React.

## 4. Data flow (analysis run)

```text
RunAnalysis → startAnalysis (run=queued)
  → TaskManager task (cancellable, progress)
    → indexProject (metadata-only walk, ignores, caps)
      → file contents read via FileSystemPort (skips binary/generated)
        → AnalysisEngine: analyzers in profile order
          → NewFinding[] → materialized Findings (ids, timestamps)
            → AnalysisRepository + AnalysisCompleted event
              → buildReport → Report (markdown/html/json/csv/sarif)
```

## 5. Persistence strategy

See `docs/persistence.md` and ADR-004. Application ports
(`packages/application/src/ports.ts`) are implemented by JSON-file
repositories today (`JsonDocumentStore`, atomic temp+rename writes) and by
SQLite tomorrow using the checked-in DDL (`packages/persistence/src/schema.ts`).
Only metadata is stored — never project source bytes.

## 6. Event architecture

Typed `AppEvent`s (`packages/domain/src/events.ts`, 23 canonical names) flow
through the application `EventBus`. Modules subscribe without importing each
other. UI activity feed, audit writes, and task updates all derive from events.
See `docs/events-tasks.md`.

## 7. Task architecture

`TaskManager` models queued → running → completed|failed|cancelled (+ paused)
with cooperative cancellation (AbortSignal), progress callbacks, and priorities.
Indexing, analysis, reports, agent runs, and executions all run as tasks, so
the UI thread never blocks. See `docs/events-tasks.md`.

## 8. Security model

See `docs/security-model.md` + ADR-009/010. Summary: path-guard on every FS
crossing, policy engine (most-specific-wins, fail-closed), permission requests
with human approve/reject, shell-free allowlisted execution, secret redaction
on logs/context/errors, append-only audit, emergency stop, and a Rust-side
re-validation (traversal rejection, session-registered roots, no symlinks).

## 9. AI architecture

See `docs/ai-architecture.md` + ADR-008. Provider-agnostic gateway
(`AIProvider`), OpenAI-compatible HTTP provider (covers OpenAI, DeepSeek,
OpenRouter, Ollama/LM Studio, custom endpoints), deterministic mock for
tests/offline, budgeted + redacted context assembly (explicit file lists —
whole projects are never silently uploaded).

## 10. Extension architecture

Stable seams for Phase 2+: `Analyzer` + `AnalyzerRegistry` (language/plugin
analyzers), `AIProvider` + `ProviderFactory` (new vendors), `Agent` + tool
allowlist (new agents), report `render()` (new formats; PDF renders from HTML),
execution `AllowlistEntry` (new commands), ignore sources (`builtin |
gitignore | app | project | profile`).

## 11. Scalability strategy

Metadata-only indexing with file caps and size caps; incremental-ready
(path+hash keys, `ContentCache`, invalidation on change); budgeted AI context
(char + file budgets, truncation reporting); background tasks with progress and
cancellation; lazy UI rendering (capped lists, on-demand file reads). Targets:
repos up to ~200k files indexed without UI freezes; millions of lines via the
Rust sidecar + retrieval layer in later phases.

## 12. Testing strategy

See `docs/testing-strategy.md`. 60 tests in Prompt 1: unit (domain, policy,
redaction, cache, diff), integration (engine over fixtures, agent gate,
executor spawning real allowlisted commands, JSON repos on temp dirs, full
store flow demo→analysis→report→chat), and contract tests (layering
enforcement). Quality gates: `npm test`, `typecheck`, `lint` (zero warnings),
`format:check`, `build`.

## 13. Configuration

Typed `AppConfig` (`packages/infrastructure/src/config.ts`): AI providers
(endpoint + credential _reference_, never the secret), analysis, indexing,
execution, security (emergency stop, default policy, audit retention).
User-level over defaults, project-level over user-level; `validateConfig()`
returns issues; `describeConfig()` is safe for diagnostics.
