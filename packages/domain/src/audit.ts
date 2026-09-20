import type { AuditEventId, ProjectId } from './ids.js';

/**
 * Immutable audit trail for sensitive actions. Append-only: repositories must
 * reject updates/deletes (enforced by implementations + tests).
 */
export type AuditCategory = 'security' | 'execution' | 'agent' | 'analysis' | 'data';

export interface AuditEvent {
  id: AuditEventId;
  projectId?: ProjectId;
  category: AuditCategory;
  action: string;
  /** Actor: 'user' | agent id | 'system'. */
  actor: string;
  target?: string;
  /** Redacted metadata only — never secrets, keys, or file bytes. */
  metadata: Record<string, unknown>;
  at: string;
}
