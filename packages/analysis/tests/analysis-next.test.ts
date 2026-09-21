import { describe, expect, it } from 'vitest';
import type { FileNode, Finding } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';
import type { AnalyzerContext } from '../src/analyzer.js';
import { DeepCorrectnessAnalyzer } from '../src/builtin/deep-correctness.js';
import { applySuppressions, parseSuppressions } from '../src/suppressions.js';
import { diffRuns } from '../src/run-diff.js';

function node(relativePath: string, extension: string): FileNode {
  return {
    id: newId('file'),
    projectId: 'p1' as FileNode['projectId'],
    path: `/p/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    extension,
    language: extension === 'py' ? 'python' : 'typescript',
    size: 10,
    ignored: false,
    generated: false,
    binary: false,
    analyzed: false,
    importance: 0,
    risk: 0,
  };
}

function ctx(files: { path: string; ext: string; content: string }[]): AnalyzerContext {
  return {
    analysisId: 'a1' as AnalyzerContext['analysisId'],
    projectId: 'p1' as AnalyzerContext['projectId'],
    projectRoot: '/p',
    files: files.map((file) => ({ node: node(file.path, file.ext), content: file.content })),
  };
}

const PY_FILE = [
  'import os',
  'import json',
  '',
  'def connect(host, port):',
  '    print("connecting")',
  '    if port:',
  '        return host',
  '    return',
  '',
  '',
  'def main():',
  '    helper(1)',
  '    connect("db")',
  '    return 1',
].join('\n');

describe('Python deep analysis', () => {
  it('finds indentation, names, arity, return, and print issues', async () => {
    const result = await new DeepCorrectnessAnalyzer().analyze(
      ctx([{ path: 'app/service.py', ext: 'py', content: PY_FILE }]),
    );
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('deep-correctness.py-unused-import');
    expect(rules).toContain('deep-correctness.py-arity-mismatch');
    expect(rules).toContain('deep-correctness.py-undefined-name');
    expect(rules).toContain('deep-correctness.py-inconsistent-return');
    expect(rules).toContain('deep-correctness.py-print-statement');

    const unused = result.findings.find(
      (finding) => finding.ruleId === 'deep-correctness.py-unused-import',
    )!;
    expect(unused.title).toContain('os');

    const arity = result.findings.find(
      (finding) => finding.ruleId === 'deep-correctness.py-arity-mismatch',
    )!;
    expect(arity.line).toBe(13);
    expect(arity.description).toContain('on line 4');

    const undefinedName = result.findings.find(
      (finding) => finding.ruleId === 'deep-correctness.py-undefined-name',
    )!;
    expect(undefinedName.title).toContain('helper');

    const inconsistent = result.findings.find(
      (finding) => finding.ruleId === 'deep-correctness.py-inconsistent-return',
    )!;
    expect(inconsistent.line).toBe(8);
  });

  it('flags bad dedents and mixed tabs with exact lines', async () => {
    const result = await new DeepCorrectnessAnalyzer().analyze(
      ctx([
        {
          path: 'app/bad.py',
          ext: 'py',
          content: [
            'def main():',
            '    if True:',
            '        pass',
            '  return 1',
            'def other():',
            '\treturn 2',
          ].join('\n'),
        },
      ]),
    );
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('deep-correctness.py-bad-dedent');
    expect(rules).toContain('deep-correctness.py-mixed-indentation');
    const dedent = result.findings.find(
      (finding) => finding.ruleId === 'deep-correctness.py-bad-dedent',
    )!;
    expect(dedent.line).toBe(4);
  });
});

describe('suppressions', () => {
  it('parses line, next-line, and file scopes', () => {
    const suppressions = parseSuppressions(
      [
        'const a = 1; // tahlely-ignore strict-quality.var-declaration',
        '// tahlely-ignore-next-line',
        'debugger;',
        '// tahlely-ignore-file dead-code.unreferenced-export',
      ].join('\n'),
    );
    expect(suppressions).toHaveLength(3);
    expect(suppressions[0]).toMatchObject({
      line: 1,
      scope: 'line',
      ruleId: 'strict-quality.var-declaration',
    });
    expect(suppressions[1]).toMatchObject({ line: 2, scope: 'next-line', ruleId: undefined });
    expect(suppressions[2]).toMatchObject({ scope: 'file' });
  });
});

function makeFinding(ruleId: string, path: string, line: number | undefined, id: string): Finding {
  const now = utcNow();
  return {
    id: id as Finding['id'],
    projectId: 'p1' as Finding['projectId'],
    analysisId: 'a1' as Finding['analysisId'],
    category: 'correctness',
    ruleId,
    title: 't',
    description: 'd',
    severity: 'high',
    confidence: 'high',
    source: 'analyzer',
    evidence: [],
    relatedFiles: [],
    relatedSymbols: [],
    status: 'open',
    createdAt: now,
    updatedAt: now,
    path,
    line,
  };
}

describe('applySuppressions + diffRuns', () => {
  it('filters findings by file, line, and rule', () => {
    const findings = [
      makeFinding('strict-quality.var-declaration', 'a.ts', 1, 'f1'),
      makeFinding('strict-quality.debugger', 'a.ts', 1, 'f2'),
      makeFinding('strict-quality.debugger', 'a.ts', 3, 'f3'),
    ];
    const contents = new Map([
      ['a.ts', 'var a = 1; // tahlely-ignore strict-quality.var-declaration\nfoo();\ndebugger;'],
    ]);
    const visible = applySuppressions(findings, contents);
    expect(visible.map((finding) => `${finding.ruleId}@${finding.line}`)).toEqual([
      'strict-quality.debugger@1',
      'strict-quality.debugger@3',
    ]);
  });

  it('separates introduced, resolved, and persisting findings', () => {
    const before = [makeFinding('r.a', 'a.ts', 1, 'f1'), makeFinding('r.b', 'a.ts', 2, 'f2')];
    const after = [makeFinding('r.a', 'a.ts', 1, 'f3'), makeFinding('r.c', 'b.ts', 1, 'f4')];
    const diff = diffRuns(before, after);
    expect(diff.persisting.map((finding) => finding.id)).toEqual(['f3']);
    expect(diff.resolved.map((finding) => finding.id)).toEqual(['f2']);
    expect(diff.introduced.map((finding) => finding.id)).toEqual(['f4']);
  });
});
