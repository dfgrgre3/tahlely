import { describe, expect, it } from 'vitest';
import type { FileNode } from '@tahlely/domain';
import { newId } from '@tahlely/domain';
import type { AnalyzerContext } from '../src/analyzer.js';
import { DeepCorrectnessAnalyzer } from '../src/builtin/deep-correctness.js';
import { DependencyAnalyzer } from '../src/builtin/dependency-analyzer.js';
import { ComplexityAnalyzer, collectFunctions } from '../src/builtin/complexity-analyzer.js';

function node(relativePath: string, extension: string): FileNode {
  return {
    id: newId('file'),
    projectId: 'p1' as FileNode['projectId'],
    path: `/p/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    extension,
    language: extension === 'ts' ? 'typescript' : 'json',
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

const BROKEN_TS = [
  'import { unusedHelper, used } from "./helper";',
  "const name = 'ok';",
  'export function run() {',
  '  const value = 1;',
  '  if (value = 2) {',
  '    missingFunction(value);',
  '  }',
  '  return used(value);',
  '}',
  'const run = 1;',
].join('\n');

describe('DeepCorrectnessAnalyzer', () => {
  it('finds real errors with file/line and language-aware checks', async () => {
    const result = await new DeepCorrectnessAnalyzer().analyze(
      ctx([{ path: 'src/broken.ts', ext: 'ts', content: BROKEN_TS }]),
    );
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('deep-correctness.unused-import');
    expect(rules).toContain('deep-correctness.assignment-in-condition');
    expect(rules).toContain('deep-correctness.undefined-identifier');
    expect(rules).toContain('deep-correctness.duplicate-declaration');

    const unusedImport = result.findings.find(
      (finding) => finding.ruleId === 'deep-correctness.unused-import',
    )!;
    expect(unusedImport.line).toBe(1);
    expect(unusedImport.title).toContain('unusedHelper');

    const undefinedCall = result.findings.find(
      (finding) => finding.ruleId === 'deep-correctness.undefined-identifier',
    )!;
    expect(undefinedCall.line).toBe(6);
  });

  it('detects bracket breakage', async () => {
    const result = await new DeepCorrectnessAnalyzer().analyze(
      ctx([
        {
          path: 'src/parse.ts',
          ext: 'ts',
          content: ['export function broken() {', '  return ];', '}'].join('\n'),
        },
      ]),
    );
    const rules = result.findings.map((f) => f.ruleId);
    expect(rules).toContain('deep-correctness.mismatched-bracket');
    expect(rules).toContain('deep-correctness.unmatched-closing-bracket');
  });

  it('detects an unterminated string literal', async () => {
    const result = await new DeepCorrectnessAnalyzer().analyze(
      ctx([
        {
          path: 'src/quotes.ts',
          ext: 'ts',
          content: ['export const a = "unclosed;', 'export const b = 1;'].join('\n'),
        },
      ]),
    );
    const rules = result.findings.map((f) => f.ruleId);
    expect(rules).toContain('deep-correctness.unterminated-string');
  });

  it('ignores strings and comments while scanning', async () => {
    const result = await new DeepCorrectnessAnalyzer().analyze(
      ctx([
        {
          path: 'src/clean.ts',
          ext: 'ts',
          content: [
            '// if (x = 1) {',
            '/* eval("x") */',
            'export const text = "if (x = 1) { debugger; }";',
            'export function ok(): number {',
            '  return 1;',
            '}',
          ].join('\n'),
        },
      ]),
    );
    expect(
      result.findings.filter((f) => f.ruleId.includes('assignment-in-condition')),
    ).toHaveLength(0);
    expect(result.findings.filter((f) => f.ruleId.includes('unclosed-bracket'))).toHaveLength(0);
  });
});

describe('DependencyAnalyzer', () => {
  const manifest = JSON.stringify({
    dependencies: { lodash: '^4.0.0' },
    devDependencies: { vitest: '^5.0.0' },
  });

  it('flags undeclared, unused, and dev-only runtime dependencies', async () => {
    const result = await new DependencyAnalyzer().analyze(
      ctx([
        { path: 'package.json', ext: 'json', content: manifest },
        {
          path: 'src/app.ts',
          ext: 'ts',
          content: [
            'import axios from "axios";',
            'import { readFile } from "node:fs/promises";',
            'import { vitest } from "vitest";',
            'export const run = () => axios;',
          ].join('\n'),
        },
      ]),
    );
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('dependencies.undeclared-dependency');
    expect(rules).toContain('dependencies.unused-dependency');
    expect(rules).toContain('dependencies.dev-dependency-in-runtime');

    const undeclared = result.findings.find(
      (finding) => finding.ruleId === 'dependencies.undeclared-dependency',
    )!;
    expect(undeclared.title).toContain('axios');
    expect(undeclared.line).toBe(1);
    expect(result.findings.some((finding) => finding.title.includes('node:fs'))).toBe(false);
  });
});

describe('ComplexityAnalyzer', () => {
  it('measures cyclomatic complexity and nested loops per function', () => {
    const lines = [
      'export function messy(items) {',
      '  let total = 0;',
      '  for (const item of items) {',
      '    for (const part of item) {',
      '      if (part && part.ok) total += 1;',
      '      else if (part) total -= 1;',
      '    }',
      '  }',
      '  return total;',
      '}',
    ];
    const blocks = collectFunctions(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.label).toBe('messy');
    expect(blocks[0]!.complexity).toBeGreaterThanOrEqual(5);
    expect(blocks[0]!.nestedLoops).toBe(2);
  });

  it('creates findings for complex functions', async () => {
    const body = Array.from(
      { length: 12 },
      (_v, i) => `  if (a${i} && b${i}) { total += ${i}; } else if (c${i}) { total -= ${i}; }`,
    ).join('\n');
    const result = await new ComplexityAnalyzer().analyze(
      ctx([
        {
          path: 'src/messy.ts',
          ext: 'ts',
          content: ['export function messy() {', body, '  return total;', '}'].join('\n'),
        },
      ]),
    );
    const complexity = result.findings.find(
      (finding) => finding.ruleId === 'complexity.high-cyclomatic-complexity',
    )!;
    expect(complexity.line).toBe(1);
    expect(complexity.title).toContain('messy');
  });
});
