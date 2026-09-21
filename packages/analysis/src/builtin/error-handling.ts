import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, textLines, throwIfAborted } from './common.js';

const MAX_PER_FILE = 10;

/**
 * Error-handling analyzer: unhandled promise chains (then without catch),
 * async functions awaiting without try/catch, and throw inside timer
 * callbacks — the errors that silently swallow failures. Line-exact triage.
 */
export class ErrorHandlingAnalyzer implements Analyzer {
  readonly kind = 'error-handling' as const;
  readonly rulePrefix = 'error-handling.';
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
      const perFile: Omit<NewFinding, 'projectId' | 'analysisId'>[] = [];

      // Promise chains: .then( with no .catch(/try anywhere in the file.
      const thenLines: number[] = [];
      let hasCatch = false;
      lines.forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/\.then\s*\(/.test(code)) thenLines.push(index + 1);
        if (/\.catch\s*\(/.test(code) || /\btry\b/.test(code)) hasCatch = true;
      });
      if (thenLines.length > 0 && !hasCatch) {
        perFile.push(
          draft(ctx, {
            path: file.node.relativePath,
            fileId: file.node.id,
            line: thenLines[0]!,
            category: 'correctness',
            ruleId: 'error-handling.promise-without-catch',
            title: `Promise chain without rejection handling (${thenLines.length} .then)`,
            description: `${file.node.relativePath} uses .then() from line ${thenLines[0]} but has no .catch() or try — a rejection becomes an unhandled promise rejection and the failure is silent.`,
            impact: 'Silent failures and unhandledRejection crashes in Node.',
            severity: 'high',
            confidence: 'medium',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Append .catch(err => …) to the chain or wrap the await in try/catch.',
            relatedFiles: [],
            relatedSymbols: [],
          }),
        );
      }
      perFile.push(...this.functionChecks(file.node, lines));
      findings.push(...perFile.slice(0, MAX_PER_FILE).map((item) => draft(ctx, item)));
    }
    return { ...emptyResult('error-handling', scanned, Date.now() - started), findings };
  }

  private functionChecks(
    node: AnalyzerContext['files'][number]['node'],
    lines: string[],
  ): Omit<NewFinding, 'projectId' | 'analysisId'>[] {
    const makeDraft = (
      partial: Omit<
        NewFinding,
        | 'projectId'
        | 'analysisId'
        | 'path'
        | 'fileId'
        | 'source'
        | 'evidence'
        | 'relatedFiles'
        | 'relatedSymbols'
      > & {
        evidence?: NewFinding['evidence'];
        relatedFiles?: NewFinding['relatedFiles'];
        relatedSymbols?: NewFinding['relatedSymbols'];
      },
    ): Omit<NewFinding, 'projectId' | 'analysisId'> => {
      const { evidence, relatedFiles, relatedSymbols, ...rest } = partial;
      return {
        path: node.relativePath,
        fileId: node.id,
        source: 'analyzer',
        evidence: evidence ?? [],
        relatedFiles: relatedFiles ?? [],
        relatedSymbols: relatedSymbols ?? [],
        ...rest,
      };
    };
    const perFile: Omit<NewFinding, 'projectId' | 'analysisId'>[] = [];
    let depth = 0;
    const open: {
      start: number;
      depth: number;
      hasAwait: boolean;
      hasTry: boolean;
      label: string;
    }[] = [];
    lines.forEach((line, index) => {
      const lineNo = index + 1;
      const fnMatch =
        /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*async/.exec(
          line,
        );
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      if (fnMatch && /\basync\b/.test(line) && opens > 0) {
        open.push({
          start: lineNo,
          depth: depth + opens,
          hasAwait: false,
          hasTry: false,
          label: fnMatch[1] ?? fnMatch[2] ?? 'anonymous',
        });
      }
      if (/\bawait\b/.test(line)) {
        const current = open[open.length - 1];
        if (current) current.hasAwait = true;
      }
      if (/\btry\b/.test(line)) {
        const current = open[open.length - 1];
        if (current) current.hasTry = true;
      }
      depth += opens - closes;
      while (open.length > 0 && depth < open[open.length - 1]!.depth) {
        const fn = open.pop()!;
        if (fn.hasAwait && !fn.hasTry) {
          perFile.push(
            makeDraft({
              line: fn.start,
              category: 'correctness',
              ruleId: 'error-handling.async-without-try',
              title: `Async function ${fn.label} awaits without try/catch`,
              description: `${fn.label} awaits (lines ${fn.start}-${lineNo}) with no error handling; a rejection propagates unhandled to the caller.`,
              severity: 'medium',
              confidence: 'medium',
              recommendation: 'Wrap awaited calls in try/catch and surface or wrap the error.',
              relatedFiles: [],
              relatedSymbols: [fn.label],
            }),
          );
        }
      }
    });
    for (const fn of open) {
      if (fn.hasAwait && !fn.hasTry) {
        perFile.push(
          makeDraft({
            line: fn.start,
            category: 'correctness',
            ruleId: 'error-handling.async-without-try',
            title: `Async function ${fn.label} awaits without try/catch`,
            description: `${fn.label} awaits (lines ${fn.start}-${lines.length}) with no error handling; a rejection propagates unhandled to the caller.`,
            severity: 'medium',
            confidence: 'medium',
            recommendation: 'Wrap awaited calls in try/catch and surface or wrap the error.',
            relatedFiles: [],
            relatedSymbols: [fn.label],
          }),
        );
      }
    }

    lines.forEach((line, index) => {
      if (/\b(setTimeout|setInterval)\s*\(/.test(line) && /\bthrow\b/.test(line)) {
        perFile.push(
          makeDraft({
            line: index + 1,
            category: 'correctness',
            ruleId: 'error-handling.throw-in-timer',
            title: 'throw inside a timer callback',
            description: `Line ${index + 1} throws inside setTimeout/setInterval — the error escapes the event loop and crashes the process instead of reaching a handler.`,
            severity: 'medium',
            confidence: 'medium',
            recommendation: 'Handle the error inside the callback or use an error-event channel.',
            relatedFiles: [],
            relatedSymbols: [],
          }),
        );
      }
    });
    return perFile;
  }
}
