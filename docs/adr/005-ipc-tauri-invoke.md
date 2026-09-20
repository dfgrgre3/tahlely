# ADR-005 — IPC: Tauri invoke + events with capability scoping

- Status: accepted (Prompt 1)

## Decision

Renderer↔backend crosses **typed Tauri commands** (`app_ping`,
`register_root`, `fs_*`, `project_scan`) plus Tauri **events** for progress,
scoped by `capabilities/default.json` (dialog open, read-only FS in P1).

## Alternatives

- **Raw WebSocket sidecar**: more control, but a second server to secure,
  version, and ship.
- **Electron ipcMain**: N/A given ADR-001.

## Rationale

- Commands are auditable, capability-gated units — a natural fit for the
  permission model (each sensitive command maps to a permission).
- Payloads are JSON: identical shapes to domain entities, no translation
  layer.

## Tradeoffs

- String-serialized payloads; large transfers (file lists) need pagination
  or streaming in Phase 2 (`project_scan` is capped at 50k entries today).
- Command versioning discipline required as the surface grows.

## Consequences

- Frontend never assumes Tauri exists (`isTauri()` guards + demo mode).
- Mutating commands arrive only with approval plumbing (Phase 2).
