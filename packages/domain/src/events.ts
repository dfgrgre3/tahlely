import type { ProjectId } from './ids.js';

/**
 * Canonical internal event names. Modules subscribe through the application
 * EventBus without importing each other (see docs/events-tasks.md).
 */
export const APP_EVENT_NAMES = [
  'ProjectOpened',
  'ProjectClosed',
  'FileAdded',
  'FileModified',
  'FileDeleted',
  'IndexStarted',
  'IndexCompleted',
  'AnalysisStarted',
  'AnalysisProgress',
  'AnalysisCompleted',
  'FindingCreated',
  'ReportGenerated',
  'AgentStarted',
  'AgentCompleted',
  'PermissionRequested',
  'PermissionApproved',
  'PermissionRejected',
  'PatchCreated',
  'PatchApplied',
  'SnapshotCreated',
  'ExecutionStarted',
  'ExecutionCompleted',
  'ExecutionFailed',
] as const;
export type AppEventName = (typeof APP_EVENT_NAMES)[number];

export interface AppEventPayloads {
  ProjectOpened: { projectId: ProjectId; rootPath: string };
  ProjectClosed: { projectId: ProjectId };
  FileAdded: { projectId: ProjectId; path: string };
  FileModified: { projectId: ProjectId; path: string };
  FileDeleted: { projectId: ProjectId; path: string };
  IndexStarted: { projectId: ProjectId };
  IndexCompleted: { projectId: ProjectId; filesIndexed: number; durationMs: number };
  AnalysisStarted: { analysisId: string; projectId: ProjectId };
  AnalysisProgress: { analysisId: string; projectId: ProjectId; completed: number; total: number };
  AnalysisCompleted: { analysisId: string; projectId: ProjectId; findings: number };
  FindingCreated: { projectId: ProjectId; findingId: string; severity: string };
  ReportGenerated: { projectId: ProjectId; reportId: string; format: string };
  AgentStarted: { agentRunId: string; projectId: ProjectId };
  AgentCompleted: { agentRunId: string; projectId: ProjectId; status: string };
  PermissionRequested: { requestId: string; projectId: ProjectId; permission: string };
  PermissionApproved: { requestId: string; projectId: ProjectId };
  PermissionRejected: { requestId: string; projectId: ProjectId };
  PatchCreated: { patchId: string; projectId: ProjectId; targetPath: string };
  PatchApplied: { patchId: string; projectId: ProjectId; targetPath: string };
  SnapshotCreated: { snapshotId: string; projectId: ProjectId };
  ExecutionStarted: { executionId: string; projectId?: ProjectId; command: string };
  ExecutionCompleted: { executionId: string; exitCode: number; durationMs: number };
  ExecutionFailed: { executionId: string; error: string };
}

export interface AppEvent<Name extends AppEventName = AppEventName> {
  id: string;
  name: Name;
  at: string;
  projectId?: ProjectId;
  payload: AppEventPayloads[Name];
}

export type AppEventHandler<Name extends AppEventName = AppEventName> = (
  event: AppEvent<Name>,
) => void | Promise<void>;
