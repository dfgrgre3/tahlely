import { describe, expect, it } from 'vitest';
import { EventBus } from '@tahlely/application';
import {
  AnalysisEngine,
  ProjectHygieneAnalyzer,
  SecurityHeuristicsAnalyzer,
  scoreProject,
} from '@tahlely/analysis';
import type { AnalyzerFile } from '@tahlely/analysis';
import type {
  AnalysisId,
  AnalysisSummary,
  Finding,
  FileNode,
  ProjectId,
  Severity,
} from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';

function node(overrides: Partial<FileNode>): FileNode {
  return {
    id: newId('file'),
    projectId: 'prj_1' as ProjectId,
    path: `/repo/${overrides.relativePath ?? 'a.ts'}`,
    relativePath: overrides.relativePath ?? 'a.ts',
    name: overrides.relativePath?.split('/').pop() ?? 'a.ts',
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

function run(): Parameters<AnalysisEngine['execute']>[0] {
  const now = utcNow();
  return {
    id: newId('anl'),
    projectId: 'prj_1' as ProjectId,
    mode: 'tool-only',
    profileId: 'strict',
    analyzerIds: ['hygiene', 'security-heuristics'],
    targetPaths: [],
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
}

function fixture(): AnalyzerFile[] {
  return [
    {
      node: node({ relativePath: '.env', name: '.env', extension: '' }),
      content: 'DATABASE_PASSWORD="super-secret-value"',
    },
    {
      node: node({ relativePath: 'Dockerfile', name: 'Dockerfile', extension: '' }),
      content:
        'FROM node:latest\nADD https://example.com/app.tar /app\nUSER root\nCMD ["node", "app.js"]',
    },
    {
      node: node({ relativePath: '.github/workflows/ci.yml', name: 'ci.yml', extension: '.yml' }),
      content: 'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v3',
    },
    {
      node: node({ relativePath: 'package.json', name: 'package.json', extension: '.json' }),
      content: JSON.stringify({ name: 'demo', dependencies: { '@types/node': '^22.0.0' } }),
    },
    {
      node: node({ relativePath: 'src/index.ts' }),
      content:
        'export const API_KEY = "AKIAIOSFODNN7EXAMPLE";\n' +
        `export const gh = "ghp_${'x'.repeat(36)}";`,
    },
  ];
}

describe('project hygiene + secrets coverage', () => {
  it('flags env files, Dockerfile, workflow, manifest, and credential issues', async () => {
    const engine = new AnalysisEngine(new EventBus(), [
      new ProjectHygieneAnalyzer(),
      new SecurityHeuristicsAnalyzer(),
    ]);
    const { findings } = await engine.execute(run(), fixture(), {
      saveRun: async () => {},
      saveFindings: async () => {},
    });
    const rules = findings.map((finding) => finding.ruleId);
    expect(rules).toContain('hygiene.committed-env-file');
    expect(rules).toContain('hygiene.docker-latest-tag');
    expect(rules).toContain('hygiene.docker-add-remote');
    expect(rules).toContain('hygiene.docker-root-user');
    expect(rules).toContain('hygiene.gha-unpinned-action');
    expect(rules).toContain('hygiene.missing-test-script');
    expect(rules).toContain('hygiene.missing-lockfile');
    expect(rules).toContain('hygiene.types-in-dependencies');
    expect(rules).toContain('hygiene.no-test-files');
    expect(rules).toContain('security-heuristics.aws-access-key');
    expect(rules).toContain('security-heuristics.github-token');
  });
});

describe('quality score', () => {
  const now = utcNow();
  const make = (ruleId: string, severity: Severity): Finding => ({
    id: newId('fnd') as Finding['id'],
    projectId: 'prj_1' as ProjectId,
    analysisId: 'anl_1' as AnalysisId,
    category: 'security',
    ruleId,
    title: 't',
    description: 'd',
    severity,
    confidence: 'high',
    source: 'analyzer',
    evidence: [],
    relatedFiles: [],
    relatedSymbols: [],
    status: 'open',
    createdAt: now,
    updatedAt: now,
  });

  it('grades a clean project A (100)', () => {
    const clean = scoreProject([], { filesScanned: 50 } as AnalysisSummary);
    expect(clean.score).toBe(100);
    expect(clean.grade).toBe('A');
    expect(clean.criticalOpen).toBe(0);
  });

  it('drops the grade hard for critical hygiene/security leaks', () => {
    const leaked = scoreProject(
      [
        make('hygiene.committed-env-file', 'critical'),
        make('security-heuristics.aws-access-key', 'critical'),
        make('deep-correctness.unused-import', 'medium'),
      ],
      { filesScanned: 3 } as AnalysisSummary,
    );
    expect(leaked.criticalOpen).toBe(2);
    expect(leaked.hygieneIssues).toBe(2);
    expect(leaked.score).toBeLessThan(70);
    expect(['D', 'F']).toContain(leaked.grade);
    expect(leaked.topRules[0]?.count).toBeGreaterThanOrEqual(1);
  });
});
