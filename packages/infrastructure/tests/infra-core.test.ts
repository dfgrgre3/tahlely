import { describe, expect, it } from 'vitest';
import {
  ContentCache,
  Logger,
  MemorySink,
  defaultConfig,
  describeConfig,
  mergeConfig,
  validateConfig,
} from '@tahlely/infrastructure';

describe('config', () => {
  it('merges overrides and validates', () => {
    const base = defaultConfig('/data');
    const merged = mergeConfig(base, { analysis: { maxFilesPerRun: 5 } });
    expect(merged.analysis.maxFilesPerRun).toBe(5);
    expect(validateConfig(merged)).toEqual([]);
    expect(validateConfig({ ...merged, dataDir: '' })).toHaveLength(1);
  });

  it('never exposes credentials in diagnostics', () => {
    const config = defaultConfig('/data');
    config.ai.providers.push({
      id: 'openai',
      kind: 'openai-compatible',
      credentialRef: 'env:OPENAI_KEY',
      timeoutMs: 1000,
    });
    const described = JSON.stringify(describeConfig(config));
    expect(described).not.toContain('OPENAI_KEY');
  });
});

describe('logger', () => {
  it('redacts secrets in messages and context', () => {
    const sink = new MemorySink();
    const logger = new Logger({ sinks: [sink] });
    logger.info('app', 'using key sk-abcdefgh12345678', { apiKey: 'shh', ok: 1 });
    expect(sink.records).toHaveLength(1);
    const line = JSON.stringify(sink.records[0]);
    expect(line).not.toContain('sk-abcdefgh');
    expect(line).not.toContain('shh');
  });
});

describe('content cache', () => {
  it('misses on hash change and invalidates', () => {
    const cache = new ContentCache<string>();
    cache.set('a.ts', 'h1', 'v1');
    expect(cache.get('a.ts', 'h1')).toBe('v1');
    expect(cache.get('a.ts', 'h2')).toBeUndefined();
    cache.invalidate('a.ts');
    expect(cache.get('a.ts', 'h1')).toBeUndefined();
  });
});
