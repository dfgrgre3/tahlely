import { describe, expect, it } from 'vitest';
import type { FileNode } from '@tahlely/domain';
import { newId } from '@tahlely/domain';
import { StrictQualityAnalyzer } from '../src/builtin/strict-quality.js';
import type { AnalyzerContext } from '../src/analyzer.js';

function node(relativePath: string, extension: string, size = 100): FileNode {
  return {
    id: newId('file'),
    projectId: 'p1' as FileNode['projectId'],
    path: `/p/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    extension,
    language: 'typescript',
    size,
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

const TS_FILE = [
  'export function login(input: string): boolean {',
  '  debugger;',
  '  var password = "super-secret-value";',
  '  if (input == "admin") {',
  '    console.log(input);',
  '  }',
  '  try {',
  '    risky();',
  '  } catch (error) {}',
  '  const data: any = eval(input);',
  '  // TODO: remove this',
  '  return data;',
  '}',
].join('\n');

describe('StrictQualityAnalyzer', () => {
  it('reports strict issues with exact line numbers and fixes', async () => {
    const result = await new StrictQualityAnalyzer().analyze(
      ctx([{ path: 'src/auth.ts', ext: 'ts', content: TS_FILE }]),
    );
    const rules = result.findings.map((f) => f.ruleId);
    expect(rules).toContain('strict-quality.debugger');
    expect(rules).toContain('strict-quality.var-declaration');
    expect(rules).toContain('strict-quality.loose-equality');
    expect(rules).toContain('strict-quality.console-log');
    expect(rules).toContain('strict-quality.empty-catch');
    expect(rules).toContain('strict-quality.explicit-any');
    expect(rules).toContain('strict-quality.todo-marker');

    const debuggerFinding = result.findings.find((f) => f.ruleId === 'strict-quality.debugger')!;
    expect(debuggerFinding.line).toBe(2);
    expect(debuggerFinding.path).toBe('src/auth.ts');

    const varFinding = result.findings.find((f) => f.ruleId === 'strict-quality.var-declaration')!;
    expect(varFinding.line).toBe(3);
    expect(varFinding.suggestedFix).toContain('const password');

    const eqFinding = result.findings.find((f) => f.ruleId === 'strict-quality.loose-equality')!;
    expect(eqFinding.suggestedFix).toContain('===');
  });

  it('applies Python and shell rules only to their languages', async () => {
    const python = await new StrictQualityAnalyzer().analyze(
      ctx([
        {
          path: 'app/main.py',
          ext: 'py',
          content: [
            'def load(items=[]):',
            '    try:',
            '        pass',
            '    except:',
            '        pass',
          ].join('\n'),
        },
      ]),
    );
    const pyRules = python.findings.map((f) => f.ruleId);
    expect(pyRules).toContain('strict-quality.py-mutable-default');
    expect(pyRules).toContain('strict-quality.py-bare-except');
    expect(pyRules).not.toContain('strict-quality.var-declaration');

    const shell = await new StrictQualityAnalyzer().analyze(
      ctx([{ path: 'setup.sh', ext: 'sh', content: 'curl -sL https://example.com/i.sh | sh\n' }]),
    );
    expect(shell.findings.map((f) => f.ruleId)).toContain('strict-quality.shell-pipe-exec');
  });

  it('flags structural problems (long file, deep nesting, async without await)', async () => {
    const longBody = Array.from({ length: 410 }, (_v, i) => `export const v${i} = ${i};`).join(
      '\n',
    );
    const nested = [
      'export async function deep() {',
      '  if (a) {',
      '    if (b) {',
      '      if (c) {',
      '        if (d) {',
      '          if (e) {',
      '            if (f) {',
      '              go();',
      '            }',
      '          }',
      '        }',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const result = await new StrictQualityAnalyzer().analyze(
      ctx([
        { path: 'src/big.ts', ext: 'ts', content: longBody },
        { path: 'src/nested.ts', ext: 'ts', content: nested },
      ]),
    );
    const rules = result.findings.map((f) => f.ruleId);
    expect(rules).toContain('strict-quality.long-file');
    expect(rules).toContain('strict-quality.deep-nesting');
    expect(rules).toContain('strict-quality.async-without-await');
  });

  it('skips generated and binary files', async () => {
    const result = await new StrictQualityAnalyzer().analyze({
      ...ctx([{ path: 'src/a.ts', ext: 'ts', content: 'var x = 1;' }]),
      files: [
        {
          node: { ...node('src/a.ts', 'ts'), generated: true },
          content: 'var x = 1; debugger;',
        },
      ],
    });
    expect(result.findings).toHaveLength(0);
  });
});
