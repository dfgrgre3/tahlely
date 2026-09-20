import { describe, expect, it } from 'vitest';
import { computeLineDiff, formatDiff } from '../services/diff.js';

describe('line diff', () => {
  it('marks added, deleted, and context lines', () => {
    const lines = computeLineDiff('a\nb\nc\n', 'a\nB\nc\nd\n');
    const kinds = lines.map((line) => line.kind);
    expect(kinds).toContain('context');
    expect(kinds).toContain('add');
    expect(kinds).toContain('del');
    const text = formatDiff('f.ts', lines);
    expect(text).toContain('+B');
    expect(text).toContain('-b');
  });

  it('handles identical files', () => {
    const lines = computeLineDiff('x\ny\n', 'x\ny\n');
    expect(lines.every((line) => line.kind === 'context')).toBe(true);
  });
});
