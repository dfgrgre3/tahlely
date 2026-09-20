# ADR-009 — Security boundary: permission engine + approval UX

- Status: accepted (Prompt 1)

## Decision

All AI-driven sensitive actions cross a **policy engine**
(most-specific-wins, fail-closed) + **explicit human approval** surface.
Sixteen canonical permissions; levels allow/require-approval/deny; every
decision is audit-logged. `AgentService` gates _every tool call_; no handler
means rejection.

## Alternatives

- **Trust-the-agent with OS sandbox only**: better UX, but opaque failures,
  no per-action audit, and sandbox escapes become total compromise.
- **Capability tokens per run**: flexible, but harder to explain in UI and
  to review after the fact.

## Rationale

- Plan → Explain → Approve/Reject → Execute → Validate → Report → Rollback
  is explainable, auditable, and reversible — the product's core promise.
- Fail-closed defaults (writes/exec/network need approval; push + system
  access deny) make the safe path the default path.

## Tradeoffs

- Approval friction on write-heavy flows; mitigated later with scoped
  standing approvals (still explicit, still audited).

## Consequences

- UI must surface pending requests prominently (Approvals badge/feed).
- `Patch.expectedHash` + snapshots make approved actions reversible.
