import type { NewFinding } from '@tahlely/domain';
import { hashString } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, textLines, throwIfAborted } from './common.js';

const WINDOW_LINES = 10;
const MIN_BLOCK_CHARS = 200;
const MAX_GROUPS = 25;

/**
 * Duplication analyzer. Sliding-window hash over normalized lines; blocks of
 * >=10 significant lines shared by 2+ files are reported once per group.
 * Same-file repeats are ignored (often legitimate, e.g. tables).
 */
export class DuplicationAnalyzer implements Analyzer {
  readonly kind = 'duplication' as const;
  readonly rulePrefix = 'duplication.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    const byHash = new Map<string, { path: string; line: number; text: string }[]>();
    let scanned = 0;

    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated) continue;
      const lines = textLines(file.content);
      if (!lines || lines.length < WINDOW_LINES) continue;
      scanned += 1;
      const normalized = lines.map(normalizeLine);
      for (let i = 0; i + WINDOW_LINES <= normalized.length; i += 1) {
        const window = normalized.slice(i, i + WINDOW_LINES);
        if (window.some((line) => line === '')) continue;
        const text = window.join('\n');
        if (text.length < MIN_BLOCK_CHARS) continue;
        const hash = hashString(text);
        const list = byHash.get(hash) ?? [];
        if (!list.some((entry) => entry.path === file.node.relativePath)) {
          list.push({ path: file.node.relativePath, line: i + 1, text });
          byHash.set(hash, list);
        }
      }
    }

    let groups = 0;
    for (const occurrences of byHash.values()) {
      const distinctPaths = new Set(occurrences.map((o) => o.path));
      if (distinctPaths.size < 2 || groups >= MAX_GROUPS) continue;
      const first = occurrences[0];
      if (!first) continue;
      groups += 1;
      findings.push(
        draft(ctx, {
          path: first.path,
          line: first.line,
          category: 'duplication',
          ruleId: 'duplication.shared-block',
          title: `Duplicated block in ${distinctPaths.size} files`,
          description: `A ${WINDOW_LINES}-line block starting at ${first.path}:${first.line} also appears in ${occurrences
            .slice(1)
            .map((o) => `${o.path}:${o.line}`)
            .join(', ')}.`,
          severity: 'low',
          confidence: 'medium',
          source: 'analyzer',
          evidence: [
            {
              kind: 'code-excerpt',
              summary: first.text.slice(0, 240),
              ref: `${first.path}:${first.line}`,
              confidence: 'medium',
            },
          ],
          recommendation: 'Extract the shared logic into a single module.',
          relatedFiles: occurrences.map((o) => o.path),
          relatedSymbols: [],
        }),
      );
    }
    return { ...emptyResult('duplication', scanned, Date.now() - started), findings };
  }
}

function normalizeLine(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/#.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
