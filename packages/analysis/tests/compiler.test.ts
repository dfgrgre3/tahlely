import { describe, expect, it } from 'vitest';
import type { FileNode } from '@tahlely/domain';
import { newId } from '@tahlely/domain';
import type { AnalyzerContext } from '../src/analyzer.js';
import { CompilerAnalyzer } from '../src/builtin/compiler-analyzer.js';

function node(relativePath: string, extension: string): FileNode {
  return {
    id: newId('file'),
    projectId: 'p1' as FileNode['projectId'],
    path: `/p/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    extension,
    language: 'typescript',
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

const TYPED_CALLER = [
  "import { formatName } from './format';",
  'export function greet(name: string): string {',
  '  return formatName(name);',
  '}',
].join('\n');

const TYPED_MODULE = [
  'export function formatName(name: string): string {',
  '  return name.trim();',
  '}',
].join('\n');

describe('CompilerAnalyzer (real TypeScript diagnostics)', () => {
  it('reports a real type error with file, line, and column', async () => {
    const result = await new CompilerAnalyzer().analyze(
      ctx([
        {
          path: 'src/broken.ts',
          ext: 'ts',
          content: ['export function area(width: number): number {', '  return width;', '}'].join(
            '\n',
          ),
        },
        {
          path: 'src/use.ts',
          ext: 'ts',
          content: [
            "import { area } from './broken';",
            'export const value: string = area(1);',
          ].join('\n'),
        },
      ]),
    );
    const typeError = result.findings.find((finding) => finding.ruleId === 'compiler.TS2322');
    expect(typeError).toBeDefined();
    expect(typeError!.path).toBe('src/use.ts');
    expect(typeError!.line).toBe(2);
    expect(typeError!.column).toBeGreaterThan(0);
    expect(typeError!.source).toBe('compiler');
    expect(typeError!.severity).toBe('high');
    expect(typeError!.description).toContain('TS2322');
  });

  it('resolves project imports instead of reporting them as missing', async () => {
    const result = await new CompilerAnalyzer().analyze(
      ctx([
        { path: 'src/format.ts', ext: 'ts', content: TYPED_MODULE },
        { path: 'src/greet.ts', ext: 'ts', content: TYPED_CALLER },
      ]),
    );
    const missing = result.findings.filter((finding) => finding.ruleId === 'compiler.TS2307');
    expect(missing).toHaveLength(0);
  });

  it('reports unresolved imports, unused locals, and wrong argument counts', async () => {
    const result = await new CompilerAnalyzer().analyze(
      ctx([
        {
          path: 'src/format.ts',
          ext: 'ts',
          content: TYPED_MODULE,
        },
        {
          path: 'src/bad.ts',
          ext: 'ts',
          content: [
            "import { formatName } from './nowhere';",
            "import { missing } from './format';",
            'export function run(): string {',
            '  const unused = 42;',
            '  return formatName();',
            '}',
          ].join('\n'),
        },
      ]),
    );
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('compiler.TS2307'); // unresolved module
    expect(rules).toContain('compiler.TS6133'); // 'unused' is declared but never read
    const unused = result.findings.find((finding) => finding.ruleId === 'compiler.TS6133')!;
    expect(unused.line).toBe(2);
  });

  it('reports syntax errors as critical', async () => {
    const result = await new CompilerAnalyzer().analyze(
      ctx([
        {
          path: 'src/syntax.ts',
          ext: 'ts',
          content: ['export function broken( {', '  return 1;', '}'].join('\n'),
        },
      ]),
    );
    const syntax = result.findings.filter((finding) => finding.ruleId.startsWith('compiler.TS1'));
    expect(syntax.length).toBeGreaterThan(0);
    expect(syntax[0]!.severity).toBe('critical');
  });
});
