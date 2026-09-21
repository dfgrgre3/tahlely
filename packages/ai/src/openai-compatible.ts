import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Model,
  Provider,
  ToolCall,
} from '@tahlely/domain';
import { AppError } from '@tahlely/domain';
import type { AIProvider, ProviderSecrets } from './provider.js';

/**
 * OpenAI-compatible HTTP provider. Covers OpenAI, DeepSeek, OpenRouter,
 * Ollama/LM Studio (local), and any custom endpoint speaking the
 * /chat/completions protocol. Timeouts and cancellation via AbortSignal;
 * the api key travels in-memory only (header) and is never logged.
 */
export class OpenAiCompatibleProvider implements AIProvider {
  readonly providerId: string;
  readonly kind = 'openai-compatible' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    provider: Provider,
    secrets: ProviderSecrets,
    options?: { timeoutMs?: number; fetchImpl?: typeof fetch },
  ) {
    this.providerId = provider.id;
    this.baseUrl = (provider.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.apiKey = secrets.apiKey;
    this.extraHeaders = provider.extraHeaders ?? {};
    this.timeoutMs = options?.timeoutMs ?? 60000;
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  async listModels(): Promise<Model[]> {
    const payload = await this.request<{ data?: { id: string }[] }>('/models', { method: 'GET' });
    const now = new Date().toISOString();
    return (payload.data ?? []).map((entry) => ({
      id: `${this.providerId}/${entry.id}` as Model['id'],
      providerId: this.providerId as Model['providerId'],
      name: entry.id,
      host: 'cloud' as const,
      capabilities: {
        tools: true,
        streaming: true,
        vision: false,
        maxContextTokens: 32000,
        maxOutputTokens: 4096,
      },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    const payload = await this.request<OpenAiChatCompletion>('/chat/completions', {
      method: 'POST',
      body: {
        model: stripProviderPrefix(this.providerId, request.model),
        messages: request.messages.map(toWireMessage),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        tools: request.tools?.map((tool) => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parametersJsonSchema,
          },
        })),
      },
      signal: request.signal,
    });
    const choice = payload.choices[0];
    if (!choice) {
      throw new AppError('Provider returned no choices.', {
        kind: 'ai-provider',
        code: 'AI_EMPTY_RESPONSE',
      });
    }
    return {
      content: choice.message.content ?? '',
      toolCalls: (choice.message.tool_calls ?? []).map((call): ToolCall => ({
        id: call.id,
        name: call.function.name,
        argumentsJson: call.function.arguments,
      })),
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
      },
      model: payload.model,
      latencyMs: Date.now() - started,
    };
  }

  async stream(
    request: ChatRequest,
    onChunk: (chunk: { delta: string; done: boolean }) => void,
  ): Promise<ChatResponse> {
    // Phase 1 transports streaming as a single buffered chat call and emits
    // progressive chunks from the final text. True SSE parsing is Phase 2
    // (same interface, no caller changes).
    const response = await this.chat(request);
    const words = response.content.split(' ');
    for (const word of words) {
      request.signal?.throwIfAborted();
      onChunk({ delta: `${word} `, done: false });
    }
    onChunk({ delta: '', done: true });
    return response;
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: unknown; signal?: AbortSignal },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    init.signal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          'content-type': 'application/json',
          ...this.extraHeaders,
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const statusText = await safeText(response);
        if (response.status === 401 || response.status === 403) {
          throw new AppError('AI provider rejected credentials.', {
            kind: 'ai-provider',
            code: 'AI_AUTH_FAILED',
            details: { status: response.status },
          });
        }
        if (response.status === 429) {
          throw new AppError('AI provider rate limit exceeded.', {
            kind: 'ai-provider',
            code: 'AI_RATE_LIMITED',
            details: { status: response.status },
          });
        }
        throw new AppError(`AI provider error (HTTP ${response.status}).`, {
          kind: 'ai-provider',
          code: 'AI_HTTP_ERROR',
          details: { status: response.status, body: statusText.slice(0, 500) },
        });
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as { name?: string }).name === 'AbortError') {
        if (init.signal?.aborted) {
          throw new AppError('AI request was cancelled.', { kind: 'cancellation' });
        }
        throw new AppError('AI provider request timed out.', {
          kind: 'timeout',
          code: 'AI_TIMEOUT',
        });
      }
      throw new AppError('Could not reach the AI provider.', {
        kind: 'ai-provider',
        code: 'AI_NETWORK_ERROR',
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

function stripProviderPrefix(providerId: string, model: string): string {
  return model.startsWith(`${providerId}/`) ? model.slice(providerId.length + 1) : model;
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  return { role: message.role, content: message.content };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

interface OpenAiChatCompletion {
  model: string;
  choices: {
    message: {
      content: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
