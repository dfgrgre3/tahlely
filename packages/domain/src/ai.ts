import type { Timestamps } from './common.js';
import type { ModelId, ProviderId } from './ids.js';

export type ProviderKind =
  'openai-compatible' | 'anthropic' | 'google' | 'deepseek' | 'openrouter' | 'local' | 'custom';

export type ModelHost = 'cloud' | 'local';

export interface ModelCapabilities {
  tools: boolean;
  streaming: boolean;
  vision: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}

export interface ModelPricing {
  inputPerMtok?: number;
  outputPerMtok?: number;
  currency?: string;
}

export interface Provider extends Timestamps {
  id: ProviderId;
  name: string;
  kind: ProviderKind;
  /** Base URL for OpenAI-compatible/custom endpoints. Secrets stay in config. */
  baseUrl?: string;
  /** Extra HTTP headers (e.g. OpenRouter HTTP-Referer / X-Title). No secrets here. */
  extraHeaders?: Record<string, string>;
  enabled: boolean;
}

export interface Model extends Timestamps {
  id: ModelId;
  providerId: ProviderId;
  name: string;
  host: ModelHost;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
  enabled: boolean;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  model: string;
  latencyMs: number;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}
