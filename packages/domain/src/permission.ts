import type { Timestamps } from './common.js';
import type { AgentId, PermissionRequestId, PolicyId, ProjectId } from './ids.js';

/** Canonical permission catalog. Every sensitive tool maps to one of these. */
export const PERMISSIONS = [
  'READ_FILE',
  'READ_DIRECTORY',
  'WRITE_FILE',
  'CREATE_FILE',
  'RENAME_FILE',
  'MOVE_FILE',
  'DELETE_FILE',
  'RUN_COMMAND',
  'INSTALL_PACKAGE',
  'NETWORK_ACCESS',
  'GIT_READ',
  'GIT_WRITE',
  'GIT_COMMIT',
  'GIT_PUSH',
  'DATABASE_ACCESS',
  'SYSTEM_ACCESS',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Read operations are never destructive; write ops always need a decision. */
export const READ_PERMISSIONS: readonly Permission[] = ['READ_FILE', 'READ_DIRECTORY', 'GIT_READ'];

export type PermissionLevel = 'allow' | 'require-approval' | 'deny';

export type PermissionDecision = 'allow' | 'deny' | 'require-approval';

export interface Policy extends Timestamps {
  id: PolicyId;
  /** Null = global default policy. */
  projectId: ProjectId | null;
  agentId: AgentId | null;
  name: string;
  defaultLevel: PermissionLevel;
  rules: Partial<Record<Permission, PermissionLevel>>;
}

export type PermissionRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface PermissionRequest extends Timestamps {
  id: PermissionRequestId;
  projectId: ProjectId;
  agentId?: AgentId;
  permission: Permission;
  /** Human-readable summary shown in the Approvals surface. */
  action: string;
  target?: string;
  reason?: string;
  status: PermissionRequestStatus;
  decidedAt?: string;
  /** Optional user note attached to the approve/reject decision. */
  decisionNote?: string;
}

export interface PolicyEvaluation {
  decision: PermissionDecision;
  matchedRule: 'explicit' | 'default';
  level: PermissionLevel;
}
