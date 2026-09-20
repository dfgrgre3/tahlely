# ADR-006 — Code editor: Monaco behind an abstraction

- Status: accepted (Prompt 1)

## Decision

**Monaco** (`@monaco-editor/react`, lazy-loaded, CDN) behind the
`CodeEditor` abstraction (`apps/desktop/src/components/code-editor.tsx`;
`languageForFile` mapping; textarea fallback when offline/blocked).

## Alternatives

- **CodeMirror 6**: lighter, easier bundling; but no built-in diff editor
  and less VSCode parity for diagnostics/inline comments later.
- **Ace / plain textarea**: insufficient for diff views, large files, and
  future language intelligence.

## Rationale

- VSCode parity (diff editor, grammars, large-file handling) without
  building an editor; fallback keeps the app functional offline.

## Tradeoffs

- CDN load at runtime in P1 (bundled web-worker build + vendored grammars
  in Phase 2); extra ~100KB wrapper in the bundle.
- CSP must allow the CDN (scoped in `tauri.conf.json`).

## Consequences

- Callers depend on `CodeEditor`, never Monaco — the worker-bundling
  migration stays behind this boundary, as does future LSP/diagnostic wiring.
