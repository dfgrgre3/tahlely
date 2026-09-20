# ADR-002 — Frontend framework: React 19 + TypeScript + Vite

- Status: accepted (Prompt 1)

## Decision

**React 19 + TypeScript (strict) + Vite 8**, routing via React Router
(HashRouter for custom-protocol compatibility).

## Alternatives

- **Vue/Svelte**: smaller bundles, simpler reactivity; but thinner Monaco
  bindings, smaller hiring pool, and less desktop-app precedent.
- **Angular**: batteries-included DI; but heavier, slower iteration for a
  panel-rich IDE-like shell.

## Rationale

- Panel/explorer/editor/problems composition maps naturally to components;
  `@monaco-editor/react` is first-class.
- Strict TS (`noUncheckedIndexedAccess`, branded ids) carries domain
  invariants into the UI without runtime cost.
- Vite gives instant dev and a proven Tauri `devUrl`/bundle story.

## Tradeoffs

- Bundle discipline required (lazy Monaco, capped lists) — enforced by
  review, not tooling, in this phase.
- React 19 APIs are newer; we stay on stable patterns (no experimental APIs).

## Consequences

- Views stay logic-free; all rules live in packages (contract-tested).
- Hash routing avoids custom-protocol history issues.
