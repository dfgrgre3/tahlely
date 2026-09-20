# ADR-007 — Indexing & workers: incremental metadata index + task queue

- Status: accepted (Prompt 1)

## Decision

**Metadata-only incremental indexer** (`indexProject`: walk, stat, classify;
contents read on demand) driven by the **`TaskManager`** queue with progress,
cancellation, and caps — running in async workers today, Rust sidecar later.
Content hashes (`hashString`) + `ContentCache` give invalidation for free.

## Alternatives

- **Full in-memory AST of the repo**: precise but unbounded memory; freezes
  the UI on large projects.
- **LSP-only intelligence**: accurate per-file, but no project-wide index,
  slow cold start, per-language servers to ship.

## Rationale

- UI never blocks: 200k-file cap, 1MB content cap, bounded concurrency,
  cooperative abort.
- Hash-keyed caches make re-analysis after edits cheap; the same index feeds
  analyzers, agents (budgeted context), and the future knowledge graph.

## Tradeoffs

- Eventual consistency (index lags edits by design; watcher debouncing in
  Phase 2).
- Heuristic classification (importance/risk) until real symbol data lands.

## Consequences

- `FileNode.hash/modifiedAt` are the concurrency + invalidation currency.
- Knowledge-graph entities (Symbol, Dependency, Integration) extend the
  index records, not a parallel system.
