import type { ProjectScoped, Timestamps } from './common.js';
import type { AgentRunId, AnalysisId, ConversationId, MessageId, ReportId } from './ids.js';
import type { AttachmentIdShim } from './attachment-id.js';

/** Attachment ids reuse the generic id helper; kept nominal for readability. */
export type { AttachmentIdShim };

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type AttachmentKind = 'file' | 'text' | 'analysis' | 'report' | 'patch' | 'snapshot';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  label: string;
  /** Reference: file path, analysis id, report id, ... (never file bytes). */
  ref: string;
}

export interface Message extends Timestamps {
  id: MessageId;
  conversationId: ConversationId;
  role: MessageRole;
  body: string;
  attachments: Attachment[];
  analysisIds: AnalysisId[];
  reportIds: ReportId[];
  agentRunIds: AgentRunId[];
}

export type ConversationStatus = 'active' | 'archived';

export interface Conversation extends ProjectScoped, Timestamps {
  id: ConversationId;
  title: string;
  status: ConversationStatus;
  messageCount: number;
  lastActiveAt: string;
  activeAgentIds: string[];
  pinnedFilePaths: string[];
}
