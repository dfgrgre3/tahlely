import type {
  ChatRequest,
  ChatResponse,
  Model,
  Provider,
  ProviderKind,
  StreamChunk,
} from '@tahlely/domain';

export type { Provider, Model, ProviderKind };

/**
 * Provider-agnostic AI abstraction. Every vendor (OpenAI-compatible,
 * Anthropic, Google, DeepSeek, OpenRouter, local models, custom endpoints)
 * implements this interface; the rest of the app only sees AIProvider.
 * Secrets are supplied per-call via headers from the config layer — providers
 * never log or persist them.
 */
export interface AIProvider {
  readonly providerId: string;
  readonly kind: ProviderKind;
  listModels(): Promise<Model[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest, onChunk: (chunk: StreamChunk) => void): Promise<ChatResponse>;
}

export interface ProviderFactory {
  readonly kind: ProviderKind;
  create(provider: Provider, secrets: ProviderSecrets): AIProvider;
}

export interface ProviderSecrets {
  apiKey?: string;
}

export function modelRef(providerId: string, model: string): string {
  return `${providerId}/${model}`;
}
