# Events, Tasks & Observability (v0.1.0)

## Events

23 canonical `AppEvent`s (`packages/domain/src/events.ts`): project lifecycle,
file changes, index progress, analysis lifecycle, findings, reports, agent
lifecycle, permission decisions, patches, snapshots, execution lifecycle. The
application `EventBus` delivers them to subscribers with isolated failures
(handler errors are collected via `drainErrors()`, never thrown into
publishers). UI activity feed, audit writes, and cross-module reactions
(re-index on `FileModified`, approvals badge on `PermissionRequested`) all
derive from events — modules never import each other.

## Tasks

`TaskManager` (`packages/application/src/task-manager.ts`):

- statuses: queued → running → completed | failed | cancelled (+ paused);
- cooperative cancellation via `AbortSignal` + `cancelRequested` flag;
- `reportProgress(0..1)`, priorities, per-task callbacks;
- `requestCancel`, `pause`/`resume`, terminal-state helper `isTerminal`.

Indexing, analysis, reports, agent runs, executions, and imports run as tasks;
`waitForTask()` bridges background work to request/response UI flows. The
Terminal view renders live task state; nothing blocks the render loop.

## Observability

Structured `Logger` with categories (`app | analysis | agent | execution |
security | audit`), levels, child contexts, and pluggable sinks (console JSON,
in-memory for tests and the in-app log viewer). **Every record passes secret
redaction.** Never logged: API keys, passwords, tokens, credentials, private
key material. Audit events are a separate append-only store, not log lines.
