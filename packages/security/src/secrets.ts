/**
 * Secret redaction. Applied to every log line, audit metadata, AI context
 * payload, and error detail before it is stored or transmitted.
 * New patterns are appended here — never inline at call sites.
 */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g },
  { name: 'openrouter-key', pattern: /\bsk-or-v1-[A-Za-z0-9]{8,}\b/g },
  { name: 'atria-key', pattern: /\batr_[A-Za-z0-9]{8,}\b/g },
  { name: 'nvidia-key', pattern: /\bnvapi-[A-Za-z0-9_.-]{8,}\b/g },
  { name: 'github-token', pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}\b/g },
  { name: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'generic-bearer', pattern: /\b[bB]earer\s+[A-Za-z0-9\-._~+/=]{8,}/g },
  {
    name: 'assignment',
    pattern: /\b(api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*['"]?[^'"\s,}]+['"]?/gi,
  },
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
];

export const REDACTED = '[REDACTED]';

export function redactSecrets(input: string): string {
  let output = input;
  for (const { pattern } of SECRET_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

/** Redact string values inside a JSON-safe structure (logs, audit metadata). */
export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const looksSensitive = /secret|password|token|api[_-]?key|authorization/i.test(key);
      out[key] = looksSensitive && typeof entry === 'string' ? REDACTED : redactValue(entry);
    }
    return out as T;
  }
  return value;
}
