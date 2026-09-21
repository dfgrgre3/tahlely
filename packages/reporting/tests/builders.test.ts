import { describe, expect, it } from 'vitest';
import {
  buildFolderFileCoverage,
  buildReport,
  render,
  renderCsv,
  renderFileCoverageMarkdown,
  renderFolderCoverageMarkdown,
  renderHtml,
  renderMarkdown,
  renderSarif,
} from '@tahlely/reporting';
import type { AnalysisId, Finding, ProjectId } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';

function finding(overrides: Partial<Finding>): Finding {
  const now = utcNow();
  return {
    id: newId('fnd'),
    projectId: 'prj_1' as ProjectId,
    analysisId: 'anl_1' as AnalysisId,
    path: 'src/a.ts',
    line: 3,
    category: 'security',
    ruleId: 'security-heuristics.eval-use',
    title: 'Dynamic code evaluation (eval)',
    description: 'eval() executes strings as code.',
    severity: 'high',
    confidence: 'medium',
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

describe('reporting', () => {
  const report = buildReport({
    projectId: 'prj_1' as ProjectId,
    analysisIds: ['anl_1' as AnalysisId],
    title: 'Standard Analysis',
    format: 'markdown',
    findings: [
      finding({ severity: 'low', title: 'Minor note' }),
      finding({ severity: 'critical', title: 'Critical issue' }),
    ],
    generatedBy: 'tool',
  });

  it('orders findings by severity', () => {
    expect(report.findings[0]?.severity).toBe('critical');
    expect(report.sections).toHaveLength(2);
  });

  it('renders markdown, html, csv, and json', () => {
    const markdown = renderMarkdown({ ...report, format: 'markdown' });
    expect(markdown).toContain('# Standard Analysis');
    expect(markdown.indexOf('Critical issue')).toBeLessThan(markdown.indexOf('Minor note'));
    expect(renderHtml(report)).toContain('<table>');
    const csv = renderCsv(report);
    expect(csv.split('\n')).toHaveLength(3);
    expect(JSON.parse(render({ ...report, format: 'json' })).title).toBe('Standard Analysis');
  });

  it('renders spec-shaped SARIF', () => {
    const sarif = JSON.parse(renderSarif(report));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results).toHaveLength(2);
    expect(sarif.runs[0].results[0].level).toBe('error');
  });

  it('covers every folder and every file exactly once', () => {
    const indexed = [
      { relativePath: 'src/a.ts', binary: false, generated: false },
      { relativePath: 'src/b.ts', binary: false, generated: false },
      { relativePath: 'docs/guide.md', binary: false, generated: false },
    ];
    const { folders, files } = buildFolderFileCoverage(indexed, [
      finding({ path: 'src/a.ts', severity: 'high' }),
      finding({ path: 'src/a.ts', severity: 'low' }),
    ]);
    expect(files).toHaveLength(3);
    expect(folders).toHaveLength(2);
    const src = folders.find((f) => f.folder === 'src');
    expect(src?.files).toBe(2);
    expect(src?.findings).toBe(2);
    expect(src?.bySeverity['high']).toBe(1);
    expect(renderFolderCoverageMarkdown(folders)).toContain('`src`');
    const md = renderFileCoverageMarkdown(files);
    expect(md).toContain('src/a.ts — 2 issue(s)');
    expect(md).toContain('src/b.ts — 0 issue(s)');
    expect(md).toContain('Clean — no findings');
  });
});
