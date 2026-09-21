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
