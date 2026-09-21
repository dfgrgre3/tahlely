import type { Finding, ProjectId, Report, Severity } from '@tahlely/domain';
import { buildReport } from '@tahlely/reporting';
import { guessSnippetPurpose, languageForFileName } from './file-analyzer.js';

/** A single per-line improvement suggestion (deterministic, offline). */
export interface LineImprovement {
  comment: string;
  improved: string;
}

/** Unified annotation: from analyzer findings or from line heuristics. */
export interface LineAnnotation {
  /** 1-based line number. */
  line: number;
  comment: string;
  improved?: string;
  severity?: Severity;
  source: 'tool' | 'heuristic';
}

const SECRET_RE = /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'`][^"'`]{3,}["'`]/i;

/**
 * Deterministic per-line improver. Returns a comment plus the improved
 * version of the same line, or null when the line needs no improvement.
 */
export function improveLine(text: string): LineImprovement | null {
  if (/\beval\s*\(/.test(text)) {
    return {
      comment: 'eval() executes arbitrary code — parse data safely instead (e.g. JSON.parse).',
      improved: text.replace(/\beval\s*\(/, 'JSON.parse('),
    };
  }
  const secret = SECRET_RE.exec(text);
  if (secret) {
    const name = (secret[1] ?? 'SECRET').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    return {
      comment: 'Hardcoded secret in source — move it to an environment variable / secret store.',
      improved: text.replace(/["'`][^"'`]{3,}["'`]/, `process.env.${name} ?? ''`),
    };
  }
  if (/\bvar\s+/.test(text)) {
    return {
      comment: 'Prefer const/let over var for block scoping and fewer hoisting surprises.',
      improved: text.replace(/\bvar\s+/, 'const '),
    };
  }
  if (!text.includes('===') && /[^=!<>]==[^=]/.test(text)) {
    return {
      comment: 'Use strict equality (=== / !==) to avoid type-coercion bugs.',
      improved: text.replace('==', '===').replace('!=', '!=='),
    };
  }
  if (/\bconsole\.log\s*\(/.test(text)) {
    return {
      comment: 'Debug logging left in code — use a structured logger or remove before shipping.',
      improved: text.replace('console.log', 'logger.debug'),
    };
  }
  if (/\/\/\s*(TODO|FIXME)/.test(text)) {
    return {
      comment: 'Unresolved TODO/FIXME — schedule the work or remove the comment.',
      improved: text,
    };
  }
  return null;
}

/**
 * Merge analyzer findings (tool) with per-line heuristics into one annotation
 * stream, ordered by line. Findings keep their severity; heuristics are info.
 */
export function annotateLines(
  content: string,
  findings: Finding[],
  relativePath: string,
): LineAnnotation[] {
  const annotations: LineAnnotation[] = [];
  for (const finding of findings) {
    if (finding.path !== relativePath || !finding.line) continue;
    annotations.push({
      line: finding.line,
      comment: [finding.title, finding.recommendation ?? finding.description]
        .filter(Boolean)
        .join(' — '),
      improved: finding.suggestedFix,
      severity: finding.severity,
      source: 'tool',
    });
  }
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const improvement = improveLine(lines[index] ?? '');
    if (improvement) {
      annotations.push({ line: index + 1, ...improvement, source: 'heuristic' });
    }
  }
  return annotations.sort((a, b) => a.line - b.line);
}

/** Human-readable summary of what a whole file does (pane 4). */
export function describeFilePurpose(content: string, fileName: string): string {
  const lines = content.split('\n');
  const count = (pattern: RegExp): number => (content.match(pattern) ?? []).length;
  const imports = lines.filter((l) => /^\s*import\b|\brequire\(/.test(l)).length;
  const bullets = [
    `- **File:** ${fileName}`,
    `- **Detected role:** ${guessSnippetPurpose(content)}`,
    `- **Language:** ${languageForFileName(fileName)}`,
    `- **Size:** ${lines.length} lines, ${content.length} chars`,
    `- **Imports:** ${imports} · **Exports:** ${count(/\bexport\b/g)} · **Functions:** ${count(/\bfunction\b|=>/g)} · **Classes:** ${count(/\bclass\s+\w+/g)}`,
  ];
  const exported = [
    ...content.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g),
  ]
    .map((m) => m[1])
    .slice(0, 10);
  if (exported.length > 0) {
    bullets.push(`- **Public surface:** ${exported.join(', ')}`);
  }
  return bullets.join('\n');
}

/** Build (but not persist) a file-scoped report from existing findings. */
export function buildFileReport(input: {
  projectId: ProjectId;
  conversationId?: string;
  relativePath: string;
  content: string;
  findings: Finding[];
}): Report {
  const scoped = input.findings.filter((f) => f.path === input.relativePath);
  const report = buildReport({
    projectId: input.projectId,
    analysisIds: [...new Set(scoped.map((f) => f.analysisId))],
    conversationId: input.conversationId as Report['conversationId'],
    title: `File report: ${input.relativePath}`,
    format: 'markdown',
    findings: scoped,
    generatedBy: 'tool',
  });
  report.sections.unshift({
    id: 'file-overview',
    title: 'File overview',
    body: describeFilePurpose(input.content, input.relativePath),
    findingIds: [],
  });
  return report;
}
