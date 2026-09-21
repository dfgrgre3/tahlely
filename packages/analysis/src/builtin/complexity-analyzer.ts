import type { NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from './common.js';

const MAX_MEDIUM = 10;
const MAX_HIGH = 20;
const LONG_FILE_FUNCTIONS = 12;

interface FunctionBlock {
  label: string;
  start: number;
  end: number;
  complexity: number;
  nestedLoops: number;
}

const BRANCH_PATTERN = /\bif\b|\bfor\b|\bwhile\b|\bcase\b|\bcatch\b|&&|\|\||\?\?/g;
const LOOP_PATTERN = /\b(for|while)\b/g;

/** Brace-tracked function extraction with branch counting. */
export function collectFunctions(lines: string[]): FunctionBlock[] {
  const blocks: FunctionBlock[] = [];
  let depth = 0;
  const open: { label: string; start: number; depth: number; complexity: number; loops: number }[] =
    [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const fnMatch =
      /\bfunction\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)|\bdef\s+([A-Za-z_]\w*)/.exec(
        line,
      );
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (fnMatch && opens > 0) {
      open.push({
        label: fnMatch[1] ?? fnMatch[2] ?? fnMatch[3] ?? 'anonymous',
        start: lineNo,
        depth: depth + opens,
        complexity: 1,
        loops: 0,
      });
    }
    const current = open[open.length - 1];
    if (current) {
      current.complexity += (line.match(BRANCH_PATTERN) ?? []).length;
      current.loops += (line.match(LOOP_PATTERN) ?? []).length;
    }
    depth += opens - closes;
    while (open.length > 0 && depth < open[open.length - 1]!.depth) {
      const fn = open.pop()!;
      blocks.push({
        label: fn.label,
        start: fn.start,
        end: lineNo,
        complexity: fn.complexity,
        nestedLoops: fn.loops,
      });
    }
  });
  for (const fn of open) {
    blocks.push({
      label: fn.label,
      start: fn.start,
      end: lines.length,
      complexity: fn.complexity,
      nestedLoops: fn.loops,
    });
  }
  return blocks;
}

/**
 * Complexity analyzer. Approximate cyclomatic complexity per function via
 * brace tracking, plus nested-loop detection — the two signals that predict
 * bug density best in code review.
 */
export class ComplexityAnalyzer implements Analyzer {
  readonly kind = 'complexity' as const;
  readonly rulePrefix = 'complexity.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated) continue;
      if (
        !['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py'].includes(normalizedExtension(file.node))
      ) {
        continue;
      }
      if (file.content === undefined) continue;
      scanned += 1;
      const blocks = collectFunctions(file.content.split('\n'));
      for (const block of blocks) {
        const severity: Severity | undefined =
          block.complexity > MAX_HIGH
            ? 'high'
            : block.complexity > MAX_MEDIUM
              ? 'medium'
              : undefined;
        if (severity) {
          findings.push(
            draft(ctx, {
              path: file.node.relativePath,
              fileId: file.node.id,
              line: block.start,
              category: 'architecture',
              ruleId: 'complexity.high-cyclomatic-complexity',
              title: `Complex function ${block.label} (complexity ${block.complexity})`,
              description:
                `${file.node.relativePath}:${block.start} — ${block.label} has a cyclomatic complexity of ` +
                `${block.complexity} across ${block.end - block.start + 1} lines. High complexity is the ` +
                'strongest predictor of defects and makes every execution path impractical to test.',
              impact: 'Hard to test, review, and safely change.',
              severity,
              confidence: 'medium',
              source: 'analyzer',
              evidence: [
                {
                  kind: 'analyzer',
                  summary: `Branches counted between lines ${block.start}-${block.end}.`,
                  ref: `${file.node.relativePath}:${block.start}`,
                  analyzerId: 'complexity',
                  confidence: 'medium',
                },
              ],
              recommendation:
                'Split the function by responsibility, use early returns, and extract branch-heavy parts into named helpers.',
              relatedFiles: [],
              relatedSymbols: [block.label],
            }),
          );
        }
        if (block.nestedLoops >= 2) {
          findings.push(
            draft(ctx, {
              path: file.node.relativePath,
              fileId: file.node.id,
              line: block.start,
              category: 'performance',
              ruleId: 'complexity.nested-loops',
              title: `Nested loops in ${block.label} (${block.nestedLoops} levels)`,
              description: `${file.node.relativePath}:${block.start} — nested iteration multiplies work and stalls on large inputs.`,
              severity: 'medium',
              confidence: 'medium',
              source: 'analyzer',
              evidence: [],
              recommendation:
                'Index with a Map/Set for lookups, hoist invariants out of the inner loop, or batch the work.',
              relatedFiles: [],
              relatedSymbols: [block.label],
            }),
          );
        }
      }
      if (blocks.length > LONG_FILE_FUNCTIONS) {
        findings.push(
          draft(ctx, {
            path: file.node.relativePath,
            fileId: file.node.id,
            line: 1,
            category: 'architecture',
            ruleId: 'complexity.too-many-functions',
            title: `File defines ${blocks.length} functions`,
            description: `${file.node.relativePath} holds ${blocks.length} functions — likely more than one responsibility.`,
            severity: 'low',
            confidence: 'medium',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Group related functions into focused modules.',
            relatedFiles: [],
            relatedSymbols: [],
          }),
        );
      }
    }
    return { ...emptyResult('complexity', scanned, Date.now() - started), findings };
  }
}
