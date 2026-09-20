# ADR-003 — State management: Zustand

- Status: accepted (Prompt 1)

## Decision

**Zustand 5** single store (`apps/desktop/src/store/app-store.ts`) holding
view state + repository snapshots. Services own logic; the store forwards
intents and mirrors results.

## Alternatives

- **Redux Toolkit**: stronger conventions/devtools; but boilerplate-heavy for
  a small view-state surface.
- **Jotai/Signals**: fine-grained reactivity; but less ergonomic for the
  async orchestration (open → index → analyze → report) this shell needs.
- **Component state only**: insufficient — approvals badge, tasks, and
  activity span routes.

## Rationale

- Minimal API, works outside React (services stay importable in tests),
  no Provider nesting, trivially testable (`app-store.test.ts` runs the full
  user journey headlessly).

## Tradeoffs

- Fewer structural guardrails than Redux; discipline (store = view state
  only) is by convention + review.

## Consequences

- Async flows live in `services/bootstrap.ts`, never in components.
- EventBus → activity feed wiring happens once in `App`.
