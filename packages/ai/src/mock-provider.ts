import type { ChatRequest, ChatResponse, Model, ProviderId } from '@tahlely/domain';
import { AppError, utcNow } from '@tahlely/domain';
import type { AIProvider } from './provider.js';

/**
 * Deterministic mock provider. Used by tests, offline mode, and the desktop
 * shell until the user configures a real provider. Responses remain stable,
 * but they are intentionally broad and realistic so the app behaves like a
 * genuine engineering review instead of a rigid template.
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
    const excerpt = (lastUser?.content ?? '').slice(0, 180);
    const review = [
      'Executive summary: the code should be reviewed as a real engineering system, with clear attention to risk, correctness, and maintainability.',
      'Key findings: prioritize exposed secrets, unsafe input handling, error propagation, and architectural drift.',
      'Root cause: issues typically come from insufficient validation, weak boundaries, and unclear ownership of responsibilities.',
      'Security: check secrets, unsafe input handling, auth boundaries, trust assumptions, and data exposure.',
      'Correctness: verify logic, edge cases, null handling, error flows, and failure recovery.',
      'Architecture: assess coupling, module boundaries, duplication, and maintainability.',
      'Performance: identify expensive loops, repeated work, and unnecessary allocations.',
      'Risk assessment: weigh exploitability, blast radius, and operational impact before deciding the urgency.',
      'P0: remediate critical security or correctness issues immediately.',
      'P1: address reliability, maintainability, and high-impact design problems next.',
      'P2: optimize quality-of-life improvements and long-term cleanup.',
      'Suggested fixes: add validation, isolate trust boundaries, improve tests, and document rollback or mitigation paths.',
      'Overall: prefer evidence-based conclusions and concrete fixes over generic advice.',
    ].join(' ');
    await sleep(5, request.signal);
    return {
      content: `[mock:${request.model}] Comprehensive engineering review for: ${excerpt || 'the submitted code'}\n\nExecutive summary\n${review}\n\nRisk assessment\nThe most important problems are usually the ones with high impact, high likelihood, and low detection. The review should explicitly separate real production risk from minor hygiene issues.\n\nP0 / P1 / P2 priorities\n- P0: stop severe security or correctness defects and protect critical data paths.\n- P1: reduce reliability risk, improve architecture, and add regression protection.\n- P2: clean up maintainability and quality issues after the core risks are addressed.\n\nSuggested fixes\n- Add real validation and safe defaults at trust boundaries.\n- Reduce coupling and centralize shared logic.\n- Improve test coverage around failure modes and edge cases.\n- Document operational mitigations and rollback steps.`,
      toolCalls: [],
      usage: {
        promptTokens: estimateTokens(request.messages.map((m) => m.content).join('\n')),
        completionTokens: 78,
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
