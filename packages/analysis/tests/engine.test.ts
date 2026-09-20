import { describe, expect, it } from 'vitest';
import { EventBus } from '@tahlely/application';
import {
  AnalysisEngine,
  DeadCodeAnalyzer,
  DuplicationAnalyzer,
  ImportAnalyzer,
  SecurityHeuristicsAnalyzer,
  SyntaxHeuristicsAnalyzer,
} from '@tahlely/analysis';
import type { AnalyzerFile } from '@tahlely/analysis';
import type { AnalysisRun, FileNode, ProjectId } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';

function node(overrides: Partial<FileNode>): FileNode {
  return {
    id: newId('file'),
    projectId: 'prj_1' as ProjectId,
    path: `/repo/${overrides.relativePath ?? 'a.ts'}`,
    relativePath: overrides.relativePath ?? 'a.ts',
    name: 'a.ts',
    extension: '.ts',
    language: 'typescript',
    size: 10,
    ignored: false,
    generated: false,
    binary: false,
    analyzed: false,
    importance: 1,
    risk: 0,
    ...overrides,
  };
}

function run(): AnalysisRun {
  const now = utcNow();
  return {
    id: newId('anl'),
    projectId: 'prj_1' as ProjectId,
    mode: 'tool-only',
    profileId: 'standard',
    analyzerIds: ['syntax', 'imports', 'duplication', 'dead-code', 'security-heuristics'],
    targetPaths: [],
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
}

const SHARED_BLOCK = Array.from(
  { length: 12 },
  (_, i) => `const sharedValue${i} = computeSomething(${i});`,
).join('\n');

function fixture(): AnalyzerFile[] {
  return [
    {
      node: node({ relativePath: 'src/index.ts', importance: 100 }),
      content: `import { helper } from './util';\nimport { missing } from './does-not-exist';\n// TODO: wire up\nexport function main() { console.log(helper); }\n`,
    },
    {
      node: node({ relativePath: 'src/util.ts' }),
      content: `export function helper() { return 1; }\nexport function orphaned() { return 2; }\n`,
    },
    {
      node: node({ relativePath: 'src/copy-a.ts' }),
      content: `${SHARED_BLOCK}\nexport const a = 1;\n`,
    },
    {
      node: node({ relativePath: 'src/copy-b.ts' }),
      content: `${SHARED_BLOCK}\nexport const b = 2;\n`,
    },
    {
      node: node({ relativePath: 'src/config.ts' }),
      content: `export const password = "s3cret-value";\nconst data = eval(input);\n`,
    },
  ];
}

describe('analysis engine', () => {
  it('runs all built-in analyzers and materializes findings', async () => {
    const engine = new AnalysisEngine(new EventBus(), [
      new SyntaxHeuristicsAnalyzer(),
      new ImportAnalyzer(),
      new DuplicationAnalyzer(),
      new DeadCodeAnalyzer(),
      new SecurityHeuristicsAnalyzer(),
    ]);
    const saved: AnalysisRun[] = [];
    const { run: finished, findings } = await engine.execute(run(), fixture(), {
      saveRun: async (r) => {
        saved.push(r);
      },
      saveFindings: async () => {},
    });
    expect(finished.status).toBe('completed');
    expect(finished.summary?.findingsCreated).toBe(findings.length);
    const rules = new Set(findings.map((f) => f.ruleId));
    expect(rules.has('imports.broken-relative-import')).toBe(true);
    expect(rules.has('syntax.todo-marker')).toBe(true);
    expect(rules.has('duplication.shared-block')).toBe(true);
    expect(rules.has('security-heuristics.hardcoded-secret')).toBe(true);
    expect(rules.has('dead-code.unreferenced-export')).toBe(true);
    expect(saved[saved.length - 1]?.status).toBe('completed');
  });
});
