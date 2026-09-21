import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, textLines, throwIfAborted } from './common.js';

const MAX_PER_FILE = 15;

/**
 * Style consistency analyzer: conventions teams fight about in review —
 * trailing whitespace, tab/space indentation, quote mixing, missing EOF
 * newline, and snake_case names in TS/JS. Deterministic, exact lines.
 */
export class StyleConsistencyAnalyzer implements Analyzer {
  readonly kind = 'style-consistency' as const;
  readonly rulePrefix = 'style-consistency.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated) continue;
      const extension = normalizedExtension(file.node);
      if (!['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(extension)) continue;
      const lines = textLines(file.content);
      if (!lines) continue;
      scanned += 1;
      let perFile = 0;
      const push = (partial: Omit<NewFinding, 'projectId' | 'analysisId'>): void => {
        if (perFile >= MAX_PER_FILE) return;
        perFile += 1;
        findings.push(draft(ctx, partial));
      };

      lines.forEach((line, index) => {
        const lineNo = index + 1;
        if (/[ \t]+$/.test(line)) {
          push({
            path: file.node.relativePath,
            fileId: file.node.id,
            line: lineNo,
            category: 'style',
            ruleId: 'style-consistency.trailing-whitespace',
            title: 'Trailing whitespace',
            description: `Line ${lineNo} ends with whitespace — diff noise and lint failures.`,
            severity: 'info',
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Trim trailing whitespace (enable format-on-save).',
            relatedFiles: [],
            relatedSymbols: [],
          });
        }
        if (/^\t+ /.test(line)) {
          push({
            path: file.node.relativePath,
            fileId: file.node.id,
            line: lineNo,
            category: 'style',
            ruleId: 'style-consistency.tab-space-indent',
            title: 'Tab mixed with spaces in indentation',
            description: `Line ${lineNo} mixes tabs and spaces — rendering differs per editor.`,
            severity: 'low',
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Standardize on spaces (2 or 4) across the file.',
            relatedFiles: [],
            relatedSymbols: [],
          });
        }
        const snake = /\b(?:function|class)\s+([a-z]+(?:_[a-z0-9]+)+)\b/.exec(line);
        if (snake) {
          push({
            path: file.node.relativePath,
            fileId: file.node.id,
            line: lineNo,
            category: 'style',
            ruleId: 'style-consistency.snake-case-name',
            title: `snake_case identifier in TS/JS: ${snake[1]}`,
            description: `Line ${lineNo} declares ${snake[1]} — TS conventions use camelCase for functions and PascalCase for classes.`,
            severity: 'info',
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: `Rename ${snake[1]} to camelCase.`,
            relatedFiles: [],
            relatedSymbols: [snake[1]!],
          });
        }
      });

      const codeText = (file.content ?? '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .filter((line) => !line.trim().startsWith('/*') && !line.trim().startsWith('*'))
        .join('\n');
      const singleQuoted = (codeText.match(/'[^'\n]*'/g) ?? []).length;
      const doubleQuoted = (codeText.match(/"[^"\n]*"/g) ?? []).length;
      if (singleQuoted >= 3 && doubleQuoted >= 3) {
        push({
          path: file.node.relativePath,
          fileId: file.node.id,
          line: 1,
          category: 'style',
          ruleId: 'style-consistency.mixed-quotes',
          title: 'Mixed quote styles',
          description: `${file.node.relativePath} uses both single quotes (${singleQuoted}) and double quotes (${doubleQuoted}) — pick one convention.`,
          severity: 'info',
          confidence: 'high',
          source: 'analyzer',
          evidence: [],
          recommendation: 'Standardize on one quote style and add a formatter rule.',
          relatedFiles: [],
          relatedSymbols: [],
        });
      }

      if ((file.content ?? '').length > 0 && !file.content!.endsWith('\n')) {
        push({
          path: file.node.relativePath,
          fileId: file.node.id,
          line: lines.length,
          category: 'style',
          ruleId: 'style-consistency.missing-eof-newline',
          title: 'Missing newline at end of file',
          description: `${file.node.relativePath} does not end with a newline — POSIX tools and diffs behave better with one.`,
          severity: 'info',
          confidence: 'high',
          source: 'analyzer',
          evidence: [],
          recommendation: 'End the file with a single newline character.',
          relatedFiles: [],
          relatedSymbols: [],
        });
      }
    }
    return { ...emptyResult('style-consistency', scanned, Date.now() - started), findings };
  }
}
