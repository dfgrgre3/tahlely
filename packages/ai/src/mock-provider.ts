import type { ChatRequest, ChatResponse, Model, ProviderId } from '@tahlely/domain';
import { AppError, utcNow } from '@tahlely/domain';
import type { AIProvider } from './provider.js';

/**
 * Deterministic mock provider. Used by tests, offline mode, and the Prompt-1
 * desktop shell until the user configures a real provider. Responses are
 * fixed templates that echo the request shape — never real reasoning.
 */
export class MockProvider implements AIProvider {
  readonly providerId: string;
  readonly kind = 'local' as const;
  private readonly models: Model[];

  constructor(providerId = 'mock') {
    this.providerId = providerId;
    const now = utcNow();
    this.models = [
      {
        id: 'mock-reviewer' as Model['id'],
        providerId: providerId as ProviderId,
        name: 'mock-reviewer',
        host: 'local',
        capabilities: {
          tools: true,
          streaming: true,
          vision: false,
          maxContextTokens: 8192,
          maxOutputTokens: 2048,
        },
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  async listModels(): Promise<Model[]> {
    return this.models;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    request.signal?.throwIfAborted();
    const started = Date.now();
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const excerpt = (lastUser?.content ?? '').slice(0, 120);
    await sleep(5, request.signal);
    return {
      content: `[mock:${request.model}] Analysis scaffolding response. Prompt excerpt: ${excerpt || '(empty)'}. Configure a real provider in Settings → Models for AI reasoning.`,
      toolCalls: [],
      usage: {
        promptTokens: estimateTokens(request.messages.map((m) => m.content).join('\n')),
        completionTokens: 42,
        totalTokens: 0,
      },
      model: request.model,
      latencyMs: Date.now() - started,
    };
  }

  async stream(
    request: ChatRequest,
    onChunk: (chunk: { delta: string; done: boolean }) => void,
  ): Promise<ChatResponse> {
    const response = await this.chat(request);
    const words = response.content.split(' ');
    for (const word of words) {
      request.signal?.throwIfAborted();
      onChunk({ delta: `${word} `, done: false });
    }
    onChunk({ delta: '', done: true });
    return response;
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError('AI request was cancelled.', { kind: 'cancellation' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AppError('AI request was cancelled.', { kind: 'cancellation' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function mockModelId(): string {
  return 'mock/mock-reviewer';
}
