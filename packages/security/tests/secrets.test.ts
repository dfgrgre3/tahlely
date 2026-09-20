import { describe, expect, it } from 'vitest';
import { redactSecrets, redactValue } from '@tahlely/security';

describe('secret redaction', () => {
  it('redacts known key formats', () => {
    expect(redactSecrets('key=sk-abcdefgh12345678')).not.toContain('sk-abcdefgh');
    expect(redactSecrets('token ghp_abcdefgh1234567890')).not.toContain('ghp_');
    expect(redactSecrets('password: "s3cret!"')).not.toContain('s3cret');
  });

  it('redacts sensitive object keys', () => {
    const out = redactValue({ apiKey: 'abc123', nested: { safe: 'ok' } });
    expect(out).toEqual({ apiKey: '[REDACTED]', nested: { safe: 'ok' } });
  });

  it('leaves ordinary text untouched', () => {
    expect(redactSecrets('hello world')).toBe('hello world');
  });
});
