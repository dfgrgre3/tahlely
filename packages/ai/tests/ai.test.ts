import { describe, expect, it } from 'vitest';
import {
  MockProvider,
  OpenAiCompatibleProvider,
  ProviderRegistry,
  buildContext,
} from '@tahlely/ai';
import type { Provider, ProviderId } from '@tahlely/domain';
import { utcNow } from '@tahlely/domain';

function provider(): Provider {
  const now = utcNow();
  return {
    id: 'test-openai' as ProviderId,
    name: 'Test',
    kind: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe('mock provider', () => {
  it('answers deterministically and streams a broad, realistic audit', async () => {
    const mock = new MockProvider();
    expect(await mock.listModels()).toHaveLength(1);
    const chunks: string[] = [];
    const response = await mock.stream(
      {
        model: 'mock/mock-reviewer',
        messages: [{ role: 'user', content: 'Audit this code for security, correctness, architecture, and maintenance issues.' }],
      },
      (chunk) => chunks.push(chunk.delta),
    );
    expect(response.content).toContain('Executive summary');
    expect(response.content).toContain('Root cause');
    expect(response.content).toContain('Security');
    expect(response.content).toContain('Correctness');
    expect(response.content).toContain('Architecture');
    expect(response.content).toContain('P0');
    expect(response.content).toContain('P1');
    expect(response.content).toContain('P2');
    expect(response.content).toContain('Suggested fixes');
    expect(response.content).toContain('review');
    expect(chunks.join('')).toContain('mock');
  });
});

describe('openai-compatible provider', () => {
  it('maps chat completions and surfaces auth errors', async () => {
    const ok = new OpenAiCompatibleProvider(
      provider(),
      {},
      {
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              model: 'gpt-x',
              choices: [{ message: { content: 'looks good', tool_calls: [] } }],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            }),
            { status: 200 },
          )) as typeof fetch,
      },
    );
    const response = await ok.chat({
      model: 'test-openai/gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.content).toBe('looks good');
    expect(response.usage.totalTokens).toBe(12);

    const denied = new OpenAiCompatibleProvider(
      provider(),
      {},
      {
        fetchImpl: (async () => new Response('nope', { status: 401 })) as typeof fetch,
      },
    );
    await expect(
      denied.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/credentials/);
  });
});

describe('provider registry', () => {
  it('creates and caches provider instances', () => {
    const registry = new ProviderRegistry();
    const first = registry.getOrCreate(provider(), { apiKey: 'k' });
    expect(registry.getOrCreate(provider(), { apiKey: 'k' })).toBe(first);
    expect(() =>
      registry.getOrCreate({ ...provider(), id: 'x' as ProviderId, kind: 'anthropic' }),
    ).toThrow(/No AI factory/);
  });
});

describe('context builder', () => {
  it('budgets files and reports drops + redaction', () => {
    const assembled = buildContext(
      'sys',
      'review',
      [
        { path: 'a.ts', content: 'const x = 1;\n' },
        { path: 'secret.ts', content: 'const apiKey = "sk-abcdefgh12345678";\n' },
        { path: 'big.ts', content: `${'y\n'.repeat(5000)}` },
      ],
      { maxChars: 600, maxFiles: 5 },
    );
    expect(assembled.redacted).toBe(true);
    expect(assembled.messages[1]?.content).not.toContain('sk-abcdefgh');
    expect(assembled.droppedFiles.length).toBeGreaterThan(0);
  });
});
