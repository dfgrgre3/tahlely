# ADR-004 — Persistence: SQLite target, JSON-file Prompt-1 implementation

- Status: accepted (Prompt 1)

## Decision

Target **SQLite (WAL, foreign keys)** owned by the Rust backend
(`<app-data>/tahlely.sqlite`, DDL checked in at
`packages/persistence/src/schema.ts`). Ship Prompt 1 with **JSON-file
repositories** (`JsonDocumentStore`, atomic temp+rename) + in-memory and
localStorage variants behind the **same application ports**.

## Alternatives

- **IndexedDB**: browser-native but awkward from Rust, weak relational
  queries for audit/findings joins.
- **Flat JSON only**: no transactions, poor queryability at scale.
- **Embedded Postgres/others**: operational overkill for a desktop app.

## Rationale

- Relational audit/conversation/finding queries, single-file portability,
  cross-platform maturity, zero services to run.
- Ports make the migration a factory swap: `createRepositories` →
  `createSqliteRepositories` with zero caller changes.

## Tradeoffs

- JSON phase has no transactions; writes are whole-document (fine at P1
  scale, documented as temporary).
- SQLite needs a migration runner + schema versioning in Phase 2
  (`SCHEMA_VERSION` reserved).

## Consequences

- Only metadata is stored — never project source bytes.
- Audit stays append-only in every implementation.
