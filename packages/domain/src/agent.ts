import type { ProjectScoped, Timestamps } from './common.js';
import type { AgentId, AgentRunId, ConversationId, ModelId, ProjectId } from './ids.js';
import type { Permission } from './permission.js';

export type AgentRole =
  'reviewer' | 'analyst' | 'refactorer' | 'documenter' | 'tester' | 'planner' | 'custom';

export type AgentStatus =
  'idle' | 'queued' | 'running' | 'awaiting-approval' | 'completed' | 'failed' | 'cancelled';

export interface AgentTool {
  name: string;
  description: string;
  /** Permission gate evaluated before every invocation. */
  permission: Permission;
}

export interface Agent extends Timestamps {
  id: AgentId;
  /** Null = global agent template usable in any project. */
  projectId: ProjectId | null;
  name: string;
  role: AgentRole;
  instructions: string;
  modelId?: ModelId;
  tools: AgentTool[];
  maxSteps: number;
}

export interface AgentRun extends ProjectScoped, Timestamps {
  id: AgentRunId;
  agentId: AgentId;
  conversationId?: ConversationId;
  status: AgentStatus;
  currentStep: number;
  maxSteps: number;
  input: string;
  output?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
}
