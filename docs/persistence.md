# Persistence (v0.1.0)

## Strategy

Ports in `packages/application/src/ports.ts` (`ProjectRepository`,
`FileIndexRepository`, `AnalysisRepository`, `ConversationRepository`,
`AgentRepository`, `PolicyRepository`, `ChangeRepository`,
`ReportRepository`, append-only `AuditRepository`) decouple use cases from
storage. Two implementations ship behind the same ports:

| Implementation                                      | Location                                   | Use                                  |
| --------------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| JSON-file (`JsonDocumentStore`, atomic temp+rename) | `@tahlely/persistence/node`                | Tests, CLI tooling, migration source |
| In-memory                                           | `@tahlely/persistence` (+ `/memory`)       | Webview session, unit tests          |
| Web (localStorage)                                  | `apps/desktop/src/services/storage.ts`     | Browser/Tauri-preview persistence    |
| SQLite (WAL, FK)                                    | `packages/persistence/src/schema.ts` (DDL) | **Migration target (ADR-004)**       |

Source of truth is always the project on disk. The database holds metadata,
references, and snapshots — never source bytes.

## Data layout (JSON phase)

`<dataDir>/{workspaces,projects,file-index,analysis-runs,findings,
conversations,messages,agents,agent-runs,policies,permission-requests,
patches,snapshots,reports,audit}.json` (`dataDirLayout()`).

## SQLite target

`SQLITE_SCHEMA` (v1) covers every collection with `project_id` indexes,
`ON DELETE CASCADE`, and an append-only `audit_log`. The Rust backend will own
the database file (`rusqlite`, `<app-data>/tahlely.sqlite`); the frontend
keeps talking to ports via Tauri commands, so the swap touches no callers.
Migration: import JSON documents once, flip `createRepositories` →
`createSqliteRepositories`, keep the JSON code path for export/debug.

## Caches

`LruCache` + content-addressed `ContentCache` (path+hash keys) hold derived
data (symbols, analyzer results, model listings). File changes invalidate by
path; hash matches make stale reads impossible.
