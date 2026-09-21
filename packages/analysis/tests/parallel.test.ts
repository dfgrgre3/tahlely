import { describe, expect, it } from 'vitest';
import { EventBus } from '@tahlely/application';
import {
  AnalysisEngine,
  ComplexityAnalyzer,
  DeepCorrectnessAnalyzer,
  DependencyAnalyzer,
  ErrorHandlingAnalyzer,
  ProjectHygieneAnalyzer,
  StrictQualityAnalyzer,
  StyleConsistencyAnalyzer,
} from '@tahlely/analysis';
import type { Analyzer, AnalyzerContext, AnalyzerFile, AnalyzerResult } from '@tahlely/analysis';
import type { AnalysisRun, FileNode, Finding, ProjectId } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';

function node(relativePath: string, extension: string): FileNode {
  return {
    id: newId('file'),
    projectId: 'p1' as ProjectId,
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

const SLOPPY = [
  'import axios from "axios";',
  'export function do_work() {',
  '  const url = "https://api.example.com/items";',
  '  const name = "widget";',
  "  const mode = 'fast';",
  "  const tag = 'alpha';",
  "  const kind = 'beta';",
  '  return axios.get(url).then((r) => r.data);',
  '}',
].join('\n');

describe('StyleConsistencyAnalyzer', () => {
  it('flags naming, quote mixing, and EOF newline', async () => {
    const result = await new StyleConsistencyAnalyzer().analyze(
      ctx([{ path: 'src/sloppy.ts', ext: 'ts', content: SLOPPY }]),
    );
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('style-consistency.snake-case-name');
    expect(rules).toContain('style-consistency.mixed-quotes');
    expect(rules).toContain('style-consistency.missing-eof-newline');
    const snake = result.findings.find(
      (finding) => finding.ruleId === 'style-consistency.snake-case-name',
    )!;
    expect(snake.line).toBe(2);
  });
});

describe('ErrorHandlingAnalyzer', () => {
  it('flags promise chains without catch, async without try, and timer throws', async () => {
    const content = [
      'export async function load() {',
      '  const data = await fetch("/x");',
      '  return data;',
      '}',
      'export function poll() {',
      '  setTimeout(() => { throw new Error("boom"); }, 0);',
      '}',
      'export function chain() {',
      '  Promise.resolve().then(() => 1);',
      '}',
    ].join('\n');
    const result = await new ErrorHandlingAnalyzer().analyze(
      ctx([{ path: 'src/fragile.ts', ext: 'ts', content }]),
    );
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('error-handling.promise-without-catch');
    expect(rules).toContain('error-handling.async-without-try');
    expect(rules).toContain('error-handling.throw-in-timer');
  });

  it('does not flag when a catch/try exists', async () => {
    const content = [
      'export async function safe() {',
      '  try {',
      '    await fetch("/x");',
      '  } catch {',
      '    return null;',
      '  }',
      '}',
    ].join('\n');
    const result = await new ErrorHandlingAnalyzer().analyze(
      ctx([{ path: 'src/safe.ts', ext: 'ts', content }]),
    );
    expect(result.findings).toHaveLength(0);
  });
});

class TrackingAnalyzer implements Analyzer {
  readonly kind;
  readonly rulePrefix;
  readonly requiresAi = false;
  constructor(kind: string) {
    this.kind = kind as Analyzer['kind'];
    this.rulePrefix = `${kind}.`;
  }
  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const result: AnalyzerResult = {
      analyzerId: this.kind,
      findings: [
        {
          projectId: ctx.projectId,
          analysisId: ctx.analysisId,
          path: 'a.ts',
          line: 1,
          category: 'correctness' as const,
          ruleId: `${this.kind}.rule`,
          title: this.kind,
          description: 'd',
          severity: 'low' as const,
          confidence: 'high' as const,
          source: 'analyzer' as const,
          evidence: [],
          relatedFiles: [],
          relatedSymbols: [],
        },
      ],
      filesScanned: 1,
      filesSkipped: 0,
      durationMs: 0,
    };
    return result;
  }
}

const KINDS = [
  'deep-correctness',
  'strict-quality',
  'security-heuristics',
  'dependencies',
  'complexity',
  'hygiene',
  'style-consistency',
  'error-handling',
  'syntax',
  'imports',
  'duplication',
  'dead-code',
  'architecture',
];

function runFor(): AnalysisRun {
  const now = utcNow();
  return {
    id: newId('anl'),
    projectId: 'p1' as ProjectId,
    mode: 'tool-only',
    profileId: 'test',
    analyzerIds: KINDS as AnalysisRun['analyzerIds'],
    targetPaths: [],
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
}

describe('parallel engine execution (13 analyzers)', () => {
  const file: AnalyzerFile[] = [{ node: node('a.ts', 'ts'), content: 'export const a = 1;\n' }];

  it('runs all 13 concurrently and flattens findings in deterministic order', async () => {
    const analyzers: Analyzer[] = KINDS.map((kind) => new TrackingAnalyzer(kind));
    const engine = new AnalysisEngine(new EventBus(), analyzers);
    const { run: finished, findings } = await engine.execute(runFor(), file, {
      saveRun: async () => {},
      saveFindings: async () => {},
    });
    expect(finished.status).toBe('completed');
    expect(findings).toHaveLength(KINDS.length);
    expect(findings.map((finding) => finding.ruleId)).toEqual(KINDS.map((kind) => `${kind}.rule`));
  });

  it('produces identical results at concurrency 1 vs 7 with real analyzers', async () => {
    const makeEngine = (): AnalysisEngine =>
      new AnalysisEngine(new EventBus(), [
        new DeepCorrectnessAnalyzer(),
        new StrictQualityAnalyzer(),
        new DependencyAnalyzer(),
        new ComplexityAnalyzer(),
        new ProjectHygieneAnalyzer(),
        new StyleConsistencyAnalyzer(),
        new ErrorHandlingAnalyzer(),
      ]);
    const sloppy = [
      { path: 'src/sloppy.ts', ext: 'ts', content: SLOPPY },
      { path: 'package.json', ext: 'json', content: '{"dependencies":{"lodash":"^4"}}' },
    ];
    const files = sloppy.map((f) => ({ node: node(f.path, f.ext), content: f.content }));
    const save = {
      saveRun: async () => {},
      saveFindings: async () => {},
    };
    const sequential = await makeEngine().execute(runFor(), files, save, {}, { concurrency: 1 });
    const parallel = await makeEngine().execute(runFor(), files, save, {}, { concurrency: 7 });
    const signature = (findings: readonly Finding[]) =>
      findings.map((finding) => `${finding.ruleId}|${finding.path ?? ''}|${finding.line ?? ''}`);
    expect(signature(parallel.findings)).toEqual(signature(sequential.findings));
    expect(sequential.findings.length).toBeGreaterThan(0);
  });
});
