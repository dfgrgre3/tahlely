/**
 * Branded identifiers. The brand is the id prefix (`newId('prj')` returns a
 * `ProjectId`), so ids of different entities can never mix while remaining
 * plain strings at runtime (JSON-safe for persistence/IPC).
 */
export type Brand<Kind extends string, T = string> = T & { readonly __brand: Kind };

export type WorkspaceId = Brand<'WorkspaceId'>;
export type ProjectId = Brand<'prj'>;
export type FileId = Brand<'file'>;
export type AnalysisId = Brand<'anl'>;
export type FindingId = Brand<'fnd'>;
export type ReportId = Brand<'rep'>;
export type ConversationId = Brand<'conv'>;
export type MessageId = Brand<'msg'>;
export type AgentId = Brand<'agent'>;
export type AgentRunId = Brand<'run'>;
export type ModelId = Brand<'ModelId'>;
export type ProviderId = Brand<'ProviderId'>;
export type PermissionRequestId = Brand<'perm'>;
export type PolicyId = Brand<'pol'>;
export type PatchId = Brand<'patch'>;
export type SnapshotId = Brand<'snap'>;
export type TaskId = Brand<'task'>;
export type AuditEventId = Brand<'audit'>;
export type ActionPlanId = Brand<'ActionPlanId'>;

const COUNTERS = new Map<string, number>();

/**
 * Collision-resistant id for local use. The prefix determines the brand
 * (e.g. `newId('prj')` is a `ProjectId`). Uses crypto.randomUUID when
 * available (Node 19+, modern browsers, secure contexts) with a
 * deterministic fallback for constrained environments.
 */
export function newId<T extends string>(prefix: T): Brand<T> {
  const random = (() => {
    try {
      const g = globalThis as { crypto?: { randomUUID?: () => string } };
      if (g.crypto?.randomUUID) return g.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    } catch {
      // fall through to counter fallback
    }
    const next = (COUNTERS.get(prefix) ?? 0) + 1;
    COUNTERS.set(prefix, next);
    return `${Date.now().toString(36)}${next.toString(36).padStart(4, '0')}`;
  })();
  return `${prefix}_${random}` as Brand<T>;
}

/** Type-guard helper: does the raw string carry the expected prefix? */
export function isIdOf(prefix: string, value: unknown): value is Brand<string> {
  return typeof value === 'string' && value.startsWith(`${prefix}_`);
}
