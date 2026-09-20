# ADR-010 — Filesystem access: port + adapters with dual validation

- Status: accepted (Prompt 1)

## Decision

All file access crosses **`FileSystemPort`** with the TS-side **path guard**
(`resolveInsideRoot`: normalization, traversal/sibling/absolute-escape and
null-byte rejection) and **independent Rust-side re-validation**
(`reject_dangerous`, session `allowed_roots`, no symlink following).
Adapters: `NodeFileSystem` (tests/CLI), `TauriFileSystem` (invoke),
`MemoryFileSystem` (tests/demo).

## Alternatives

- **Direct `fs` in components/services**: expedient but un-auditable and
  untestable; rejected outright.
- **Single-side validation**: cheaper, but a renderer compromise becomes a
  host compromise.

## Rationale

- One seam to audit; platform specifics (case sensitivity, separators,
  link behavior) stay in adapters behind posix-normalized contracts.
- Dual validation means either layer can stop an escape on its own.

## Tradeoffs

- Every new FS capability needs a port method + adapter implementations +
  capability entries (deliberate friction for a security boundary).
- Symlink policies differ per OS; P1 stance is conservative (never follow
  in scans; explicit validation later).

## Consequences

- Browser-safe barrels exclude `node:` adapters (`/node` subpaths).
- Binary files are described, never decoded; generated files are indexed
  but excluded from AI context and most rules.
