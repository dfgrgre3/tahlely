import type { ProjectScoped, Timestamps } from './common.js';
import type { ActionPlanId, AgentRunId, ConversationId, PatchId, SnapshotId } from './ids.js';

export type PatchRisk = 'low' | 'medium' | 'high';
export type PatchStatus =
  'proposed' | 'approved' | 'rejected' | 'applied' | 'failed' | 'rolled-back';

export interface PatchValidation {
  targetExists: boolean;
  hashMatched: boolean;
  syntaxCheck?: 'passed' | 'failed' | 'skipped';
  notes: string[];
}

/**
 * A reversible file modification proposal. `expectedHash` implements
 * optimistic concurrency: two agents cannot blindly overwrite each other —
 * application rejects the patch when the file moved on.
 */
export interface Patch extends ProjectScoped, Timestamps {
  id: PatchId;
  conversationId?: ConversationId;
  agentRunId?: AgentRunId;
  targetPath: string;
  expectedHash?: string;
  oldText?: string;
  newText: string;
  diff?: string;
  affectedLines?: { start: number; end: number };
  reason?: string;
  risk: PatchRisk;
  status: PatchStatus;
  validation?: PatchValidation;
}

export interface SnapshotFile {
  path: string;
  hash: string;
  size: number;
}

export interface Snapshot extends ProjectScoped {
  id: SnapshotId;
  conversationId?: ConversationId;
  agentRunId?: AgentRunId;
  label: string;
  operation: string;
  files: SnapshotFile[];
  createdAt: string;
}

export type ActionStepKind = 'read' | 'analyze' | 'patch' | 'execute' | 'snapshot' | 'report';

export interface ActionStep {
  id: string;
  kind: ActionStepKind;
  summary: string;
  permissionRequired?: string;
  patchId?: PatchId;
}

export type ActionPlanStatus =
  'draft' | 'pending-approval' | 'approved' | 'rejected' | 'executing' | 'done';

export interface ActionPlan extends ProjectScoped, Timestamps {
  id: ActionPlanId;
  conversationId?: ConversationId;
  agentRunId?: AgentRunId;
  title: string;
  steps: ActionStep[];
  status: ActionPlanStatus;
}
