import type { Finding, Report, ReportFormat, Severity } from '@tahlely/domain';
import { SEVERITY_RANK, newId, utcNow } from '@tahlely/domain';
import type { AnalysisId, ConversationId, ProjectId } from '@tahlely/domain';
export interface ReportInput {
  projectId: ProjectId;
  analysisIds: AnalysisId[];
  conversationId?: ConversationId;
  title: string;
  format: ReportFormat;
  findings: Finding[];
  generatedBy: Report['generatedBy'];
}

const EMOJI_FOR: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.path ?? '').localeCompare(b.path ?? '') ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

/** Assemble the canonical Report record (single source for all exporters). */
export function buildReport(input: ReportInput): Report {
  const findings = sortFindings(input.findings);
  const bySeverity = countBy(findings, (f) => f.severity);
  const summary = [
    `Total findings: ${findings.length}`,
    ...Object.entries(bySeverity).map(([severity, count]) => `${severity}: ${count}`),
  ].join(' · ');
  return {
    id: newId('rep'),
    projectId: input.projectId,
    analysisIds: input.analysisIds,
    conversationId: input.conversationId,
    title: input.title,
    format: input.format,
    sections: [
      {
        id: 'summary',
        title: 'Summary',
        body: summary,
        findingIds: findings.map((f) => f.id),
      },
      {
        id: 'findings',
        title: 'Findings',
        body: `${findings.length} findings ordered by severity.`,
        findingIds: findings.map((f) => f.id),
      },
    ],
    findings,
    generatedBy: input.generatedBy,
    createdAt: utcNow(),
  };
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function renderMarkdown(report: Report): string {
  const lines: string[] = [
    `# ${report.title}`,
    '',
    `Generated: ${report.createdAt} · Source: ${report.generatedBy}`,
    '',
  ];
  // Every section is rendered in order; the findings table is appended last
  // from the canonical finding list, so tool/AI narrative sections survive.
  for (const section of report.sections) {
    if (section.id === 'findings') continue;
    lines.push(`## ${section.title}`, '', section.body, '');
  }
  lines.push('## Findings', '');
  for (const finding of report.findings) {
    const location = finding.path
      ? `${finding.path}${finding.line ? `:${finding.line}` : ''}`
      : '(project-wide)';
    lines.push(`### ${EMOJI_FOR[finding.severity]} ${finding.title}`);
    lines.push('');
    lines.push(
      `- Severity: **${finding.severity}** · Confidence: ${finding.confidence} · Source: ${finding.source}`,
    );
    lines.push(`- Rule: \`${finding.ruleId}\` · Location: \`${location}\``);
    lines.push('');
    lines.push(finding.description);
    if (finding.recommendation) {
      lines.push('');
      lines.push(`**Recommendation:** ${finding.recommendation}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

export function renderHtml(report: Report): string {
  const rows = report.findings
    .map(
      (finding) =>
        `<tr><td>${finding.severity}</td><td>${escapeHtml(finding.title)}</td>` +
        `<td><code>${escapeHtml(finding.path ?? '')}${finding.line ? `:${finding.line}` : ''}</code></td>` +
        `<td><code>${escapeHtml(finding.ruleId)}</code></td></tr>`,
    )
    .join('\n');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(report.title)}</title></head><body>`,
    `<h1>${escapeHtml(report.title)}</h1>`,
    `<p>Generated: ${escapeHtml(report.createdAt)} · Source: ${escapeHtml(report.generatedBy)}</p>`,
    `<p>${escapeHtml(report.sections[0]?.body ?? '')}</p>`,
    '<table><thead><tr><th>Severity</th><th>Title</th><th>Location</th><th>Rule</th></tr></thead>',
    `<tbody>${rows}</tbody></table></body></html>`,
  ].join('\n');
}

export function renderCsv(report: Report): string {
  const header = 'severity,category,rule,title,path,line,confidence,source';
  const rows = report.findings.map((finding) =>
    [
      finding.severity,
      finding.category,
      finding.ruleId,
      csvCell(finding.title),
      csvCell(finding.path ?? ''),
      finding.line ?? '',
      finding.confidence,
      finding.source,
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

/** Minimal SARIF 2.1.0 for CI ingestion (GitHub code scanning compatible). */
export function renderSarif(report: Report): string {
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'tahlely', version: '0.1.0', rules: sarifRules(report) } },
        results: report.findings.map((finding) => ({
          ruleId: finding.ruleId,
          level: sarifLevel(finding.severity),
          message: { text: `${finding.title} — ${finding.description}`.slice(0, 1000) },
          locations: finding.path
            ? [
                {
                  physicalLocation: {
                    artifactLocation: { uri: finding.path },
                    region: finding.line ? { startLine: finding.line } : undefined,
                  },
                },
              ]
            : [],
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

function sarifRules(report: Report): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const finding of report.findings) {
    if (!seen.has(finding.ruleId)) seen.set(finding.ruleId, finding.title);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

function sarifLevel(severity: Severity): string {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function render(report: Report): string {
  switch (report.format) {
    case 'markdown':
      return renderMarkdown(report);
    case 'html':
      return renderHtml(report);
    case 'json':
      return renderJson(report);
    case 'csv':
      return renderCsv(report);
    case 'sarif':
      return renderSarif(report);
  }
}

export interface CoverageFileEntry {
  relativePath: string;
  folder: string;
  binary: boolean;
  generated: boolean;
  findings: Finding[];
  bySeverity: Record<string, number>;
}

export interface CoverageFolderEntry {
  folder: string;
  files: number;
  analyzedFiles: number;
  findings: number;
  bySeverity: Record<string, number>;
  worstFiles: { relativePath: string; findings: number }[];
}

function folderOf(relativePath: string): string {
  const parts = relativePath.split('/');
  parts.pop();
  return parts.join('/') || '(root)';
}

/**
 * Real per-folder + per-file coverage: every indexed file appears exactly
 * once (clean or with its exact findings), and every folder aggregates its
 * files with severity breakdown and worst files. Nothing is sampled.
 */
export function buildFolderFileCoverage(
  indexed: { relativePath: string; binary: boolean; generated: boolean }[],
  findings: Finding[],
): { folders: CoverageFolderEntry[]; files: CoverageFileEntry[] } {
  const byPath = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (!finding.path || finding.path === '(project)' || finding.path === '(project-wide)') continue;
    const key = finding.path.replace(/^\/+/, '');
    const bucket = byPath.get(key) ?? [];
    bucket.push(finding);
    byPath.set(key, bucket);
  }
  const files: CoverageFileEntry[] = indexed.map((node) => {
    const list = sortFindings(byPath.get(node.relativePath) ?? []);
    const bySeverity: Record<string, number> = {};
    for (const f of list) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    return {
      relativePath: node.relativePath,
      folder: folderOf(node.relativePath),
      binary: node.binary,
      generated: node.generated,
      findings: list,
      bySeverity,
    };
  });
  files.sort((a, b) => b.findings.length - a.findings.length || a.relativePath.localeCompare(b.relativePath));

  const folderMap = new Map<string, CoverageFolderEntry>();
  for (const entry of files) {
    let folder = folderMap.get(entry.folder);
    if (!folder) {
      folder = { folder: entry.folder, files: 0, analyzedFiles: 0, findings: 0, bySeverity: {}, worstFiles: [] };
      folderMap.set(entry.folder, folder);
    }
    folder.files += 1;
    if (!entry.binary && !entry.generated) folder.analyzedFiles += 1;
    folder.findings += entry.findings.length;
    for (const [severity, count] of Object.entries(entry.bySeverity)) {
      folder.bySeverity[severity] = (folder.bySeverity[severity] ?? 0) + count;
    }
  }
  for (const folder of folderMap.values()) {
    folder.worstFiles = files
      .filter((f) => f.folder === folder.folder && f.findings.length > 0)
      .slice(0, 5)
      .map((f) => ({ relativePath: f.relativePath, findings: f.findings.length }));
  }
  const folders = [...folderMap.values()].sort(
    (a, b) => b.findings - a.findings || a.folder.localeCompare(b.folder),
  );
  return { folders, files };
}

export function renderFolderCoverageMarkdown(folders: CoverageFolderEntry[]): string {
  if (folders.length === 0) return 'No folders indexed.';
  return [
    '| Folder | Files | Analyzed | Findings | Critical | High | Medium | Low | Info | Worst file |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...folders.map((f) => {
      const worst = f.worstFiles[0] ? `${f.worstFiles[0].relativePath} (${f.worstFiles[0].findings})` : '—';
      return `| \`${f.folder}\` | ${f.files} | ${f.analyzedFiles} | ${f.findings} | ${f.bySeverity['critical'] ?? 0} | ${f.bySeverity['high'] ?? 0} | ${f.bySeverity['medium'] ?? 0} | ${f.bySeverity['low'] ?? 0} | ${f.bySeverity['info'] ?? 0} | ${worst} |`;
    }),
  ].join('\n');
}

export function renderFileCoverageMarkdown(files: CoverageFileEntry[]): string {
  if (files.length === 0) return 'No files indexed.';
  return files
    .map((f) => {
      const header = `### ${f.binary ? '🧩' : f.findings.length > 0 ? '🔴' : '🟢'} ${f.relativePath} — ${f.findings.length} issue(s)`;
      if (f.binary) return `${header}\n\nBinary file — described, never decoded.`;
      if (f.generated) return `${header}\n\nGenerated file — excluded from quality scoring.`;
      if (f.findings.length === 0) return `${header}\n\nClean — no findings by any analyzer.`;
      const rows = f.findings.map(
        (finding) =>
          `- **${finding.severity}** · line ${finding.line ?? '–'}${finding.column ? `:${finding.column}` : ''} · \`${finding.ruleId}\` — ${finding.title}\n  - Fix: ${finding.recommendation ?? 'review manually'}`,
      );
      return `${header}\n\n${rows.join('\n')}`;
    })
    .join('\n\n');
}
