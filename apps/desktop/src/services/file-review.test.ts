import { describe, expect, it } from 'vitest';
import type { Finding } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';
import { annotateLines, buildFileReport, describeFilePurpose, improveLine } from './file-review.js';

function makeFinding(overrides: Partial<Finding>): Finding {
  const now = utcNow();
  return {
    id: newId('fnd'),
    projectId: 'p1' as Finding['projectId'],
    analysisId: 'a1' as Finding['analysisId'],
    category: 'security',
    ruleId: 'sec/test',
    title: 'Test finding',
    description: 'desc',
    severity: 'high',
    confidence: 'high',
    source: 'analyzer',
    evidence: [],
    relatedFiles: [],
    relatedSymbols: [],
    status: 'open',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('improveLine', () => {
  it('replaces eval with JSON.parse', () => {
    const result = improveLine('  return eval(input);');
    expect(result?.improved).toBe('  return JSON.parse(input);');
  });

  it('flags hardcoded secrets', () => {
    const result = improveLine('const password = "s3cret-value";');
    expect(result?.comment).toContain('Hardcoded secret');
    expect(result?.improved).toContain('process.env.PASSWORD');
  });

  it('converts var to const and == to ===', () => {
    expect(improveLine('var count = 1;')?.improved).toBe('const count = 1;');
    expect(improveLine('if (a == b) {')?.improved).toBe('if (a === b) {');
    expect(improveLine('if (a === b) {')).toBeNull();
  });

  it('returns null for clean lines', () => {
    expect(improveLine('export function main(): void {')).toBeNull();
  });
});

describe('annotateLines', () => {
  const content = ['const a = 1;', 'return eval(x);', 'const b = 2;'].join('\n');

  it('merges findings and heuristics on the right lines', () => {
    const findings = [
      makeFinding({ path: 'src/x.ts', line: 1, recommendation: 'Fix it', suggestedFix: 'ok();' }),
    ];
    const notes = annotateLines(content, findings, 'src/x.ts');
    expect(notes.filter((n) => n.line === 1 && n.source === 'tool')).toHaveLength(1);
    expect(notes.filter((n) => n.line === 2 && n.source === 'heuristic')).toHaveLength(1);
    expect(notes.find((n) => n.line === 1)?.improved).toBe('ok();');
  });

  it('ignores findings from other files', () => {
    const findings = [makeFinding({ path: 'src/other.ts', line: 1 })];
    expect(annotateLines(content, findings, 'src/x.ts').every((n) => n.source !== 'tool')).toBe(
      true,
    );
  });
});

describe('describeFilePurpose / buildFileReport', () => {
  const content = [
    'import { x } from "./y";',
    'export function main(): void {}',
    'export const value = 1;',
  ].join('\n');

  it('describes the public surface', () => {
    const purpose = describeFilePurpose(content, 'src/main.ts');
    expect(purpose).toContain('TypeScript module');
    expect(purpose).toContain('main, value');
    expect(purpose).toContain('**Imports:** 1');
  });

  it('builds a file-scoped report with overview section', () => {
    const findings = [
      makeFinding({ path: 'src/main.ts', line: 2 }),
      makeFinding({ path: 'src/other.ts', line: 1 }),
    ];
    const report = buildFileReport({
      projectId: 'p1' as Finding['projectId'],
      relativePath: 'src/main.ts',
      content,
      findings,
    });
    expect(report.title).toBe('File report: src/main.ts');
    expect(report.findings).toHaveLength(1);
    expect(report.sections[0]?.id).toBe('file-overview');
  });
});
