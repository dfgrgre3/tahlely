import type { ProjectId } from '@tahlely/domain';

export interface ExecutionRequest {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  projectId?: ProjectId;
  actor?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ExecutionResult {
  id: string;
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  timedOut: boolean;
}

export interface ExecutionEvents {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}
