import type { ProjectId, TaskId } from './ids.js';

export type TaskType =
  'indexing' | 'analysis' | 'report' | 'agent-run' | 'execution' | 'snapshot' | 'import';

export type TaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];

export interface TaskRecord {
  id: TaskId;
  type: TaskType;
  title: string;
  projectId?: ProjectId;
  status: TaskStatus;
  /** 0..1 progress fraction. */
  progress: number;
  priority: number;
  cancellable: boolean;
  cancelRequested: boolean;
  error?: string;
  result?: unknown;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export function isTerminal(status: TaskStatus): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}
