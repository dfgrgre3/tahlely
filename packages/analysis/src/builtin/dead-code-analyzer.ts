import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, throwIfAborted } from './common.js';

const EXPORT_PATTERN =
  /export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+([A-Za-z_$][\w$]*)/g;
const MAX_FINDINGS = 50;

/**
 * Dead-code heuristic. Collects exported JS/TS symbols and counts textual
 * references across the indexed corpus. Zero-reference exports are reported
 * with LOW confidence — this is a triage signal, not proof (dynamic imports,
 * public APIs, and entry points produce false positives, which is why the
 * confidence stays low and entry files are excluded).
 */
export class DeadCodeAnalyzer implements Analyzer {
  readonly kind = 'dead-code' as const;
  readonly rulePrefix = 'dead-code.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    const corpus: { path: string; content: string }[] = [];
    const exports: { path: string; fileId: string; line: number; name: string }[] = [];
    let scanned = 0;

    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated) continue;
      if (file.node.language !== 'typescript' && file.node.language !== 'javascript') continue;
      const content = file.content;
      if (content === undefined) continue;
      scanned += 1;
      corpus.push({ path: file.node.relativePath, content });
      EXPORT_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = EXPORT_PATTERN.exec(content)) !== null) {
        const name = match[1];
        if (!name || name === 'default') continue;
        const line = content.slice(0, match.index).split('\n').length;
        exports.push({ path: file.node.relativePath, fileId: file.node.id, line, name });
      }
    }

    for (const symbol of exports) {
      throwIfAborted(ctx);
      if (findings.length >= MAX_FINDINGS) break;
      if (isEntryFile(symbol.path)) continue;
      const usage = new RegExp(`\\b${escapeRegExp(symbol.name)}\\b`, 'g');
      let references = 0;
      for (const file of corpus) {
        const hits = file.content.match(usage)?.length ?? 0;
        references += file.path === symbol.path ? Math.max(0, hits - 1) : hits;
        if (references > 0) break;
      }
      if (references === 0) {
        findings.push(
          draft(ctx, {
            path: symbol.path,
            fileId: symbol.fileId as NewFinding['fileId'],
            line: symbol.line,
            category: 'dead-code',
            ruleId: 'dead-code.unreferenced-export',
            title: `Possibly unused export: ${symbol.name}`,
            description: `'${symbol.name}' is exported from ${symbol.path} but never referenced in the indexed corpus. Verify it is not part of a public API or loaded dynamically before removing.`,
            severity: 'low',
            confidence: 'low',
            source: 'analyzer',
            evidence: [
              {
                kind: 'analyzer',
                summary: `Zero textual references across ${corpus.length} indexed files.`,
                analyzerId: 'dead-code',
                confidence: 'low',
              },
            ],
            recommendation:
              'Remove the export or add a suppressing annotation if it is public API.',
            relatedFiles: [],
            relatedSymbols: [symbol.name],
          }),
        );
      }
    }
    return { ...emptyResult('dead-code', scanned, Date.now() - started), findings };
  }
}

function isEntryFile(path: string): boolean {
  return /(^|\/)(index|main)\.(ts|tsx|js|jsx)$/.test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
