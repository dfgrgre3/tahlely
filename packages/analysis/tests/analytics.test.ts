import { describe, expect, it } from 'vitest';
import { analyzeProject } from '@tahlely/analysis';
import type { AnalysisRun, Finding } from '@tahlely/domain';

function run(id: string, createdAt: string, profileId = 'comprehensive'): AnalysisRun {
  return {
    id: id as AnalysisRun['id'],
    projectId: 'prj_1' as AnalysisRun['projectId'],
    mode: 'tool-only',
    profileId,
    analyzerIds: [],
    targetPaths: [],
    status: 'completed',
    summary: { filesScanned: 10, filesSkipped: 0, findingsCreated: 0, bySeverity: {}, durationMs: 5 },
    createdAt,
    updatedAt: createdAt,
  };
}

function finding(id: string, ruleId: string, path: string, severity: Finding['severity'] = 'high', line = 1): Finding {
  return {
    id: id as Finding['id'],
    projectId: 'prj_1' as Finding['projectId'],
    analysisId: 'anl_1' as Finding['analysisId'],
    path,
    line,
    category: 'correctness',
    ruleId,
    title: ruleId,
    description: ruleId,
    severity,
    confidence: 'high',
    source: 'analyzer',
    evidence: [],
    relatedFiles: [],
    relatedSymbols: [],
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('project analytics', () => {
  it('computes trend, delta, hotspots, rules, and analyzer share', () => {
    const runs = [run('anl_1', '2026-01-01T00:00:00Z'), run('anl_2', '2026-01-02T00:00:00Z')];
    const analytics = analyzeProject(runs, new Map([
      ['anl_1', [finding('f1', 'security-heuristics.eval-use', 'src/a.ts'), finding('f2', 'syntax.todo-marker', 'src/b.ts', 'info')]],
      ['anl_2', [finding('f1', 'security-heuristics.eval-use', 'src/a.ts'), finding('f3', 'compiler.TS2304', 'src/a.ts', 'critical')]],
    ]));
    expect(analytics.runs).toHaveLength(2);
    expect(analytics.delta?.introduced).toBe(1);
    expect(analytics.delta?.resolved).toBe(1);
    expect(analytics.delta?.fixRate).toBeCloseTo(0.5);
    expect(analytics.hotspots.files[0]?.key).toBe('src/a.ts');
    expect(analytics.topRules[0]?.files).toBeGreaterThanOrEqual(1);
    expect(analytics.analyzers.reduce((sum, a) => sum + a.share, 0)).toBeCloseTo(1);
    expect(analytics.severityMix.reduce((sum, s) => sum + s.count, 0)).toBe(2);
  });
});
