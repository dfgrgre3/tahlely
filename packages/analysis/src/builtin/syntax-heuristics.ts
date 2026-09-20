import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, textLines, throwIfAborted } from './common.js';

const MAX_FINDINGS_PER_FILE = 20;
const LARGE_FILE_LINES = 1000;
const LONG_LINE_CHARS = 200;

const MARKERS: { token: RegExp; ruleId: string; title: string }[] = [
  { token: /\bTODO\b/, ruleId: 'syntax.todo-marker', title: 'TODO marker left in code' },
  { token: /\bFIXME\b/, ruleId: 'syntax.fixme-marker', title: 'FIXME marker left in code' },
  { token: /\bHACK\b/, ruleId: 'syntax.hack-marker', title: 'HACK marker left in code' },
];

const DEBUG_PATTERNS: { pattern: RegExp; ruleId: string; title: string }[] = [
  {
    pattern: /console\.(log|debug|info)\s*\(/,
    ruleId: 'syntax.console-output',
    title: 'Console output in source',
  },
  {
    pattern: /\bdebugger\b/,
    ruleId: 'syntax.debugger-statement',
    title: 'debugger statement in source',
  },
];

/**
 * Syntax-surface analyzer. Deterministic, dependency-free, offline.
 * Flags oversized files, leftover task markers, debug statements, and
 * overlong lines — cheap signals that correlate with review findings.
 */
export class SyntaxHeuristicsAnalyzer implements Analyzer {
  readonly kind = 'syntax' as const;
  readonly rulePrefix = 'syntax.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated) continue;
      const lines = textLines(file.content);
      if (!lines) continue;
      scanned += 1;
      let perFile = 0;
      const push = (finding: NewFinding): void => {
        if (perFile >= MAX_FINDINGS_PER_FILE) return;
        perFile += 1;
        findings.push(finding);
      };
      if (lines.length > LARGE_FILE_LINES) {
        push(
          draft(ctx, {
            path: file.node.relativePath,
            fileId: file.node.id,
            line: 1,
            category: 'correctness',
            ruleId: 'syntax.large-file',
            title: `Large file (${lines.length} lines)`,
            description: `This file has ${lines.length} lines. Large files are harder to review and usually hide unrelated responsibilities.`,
            severity: 'low',
            confidence: 'high',
            source: 'analyzer',
            evidence: [
              {
                kind: 'analyzer',
                summary: `Line count ${lines.length} exceeds ${LARGE_FILE_LINES}.`,
                analyzerId: 'syntax',
                confidence: 'high',
              },
            ],
            recommendation: 'Consider splitting this file by responsibility.',
            relatedFiles: [],
            relatedSymbols: [],
          }),
        );
      }
      lines.forEach((line, index) => {
        if (perFile >= MAX_FINDINGS_PER_FILE) return;
        const lineNo = index + 1;
        for (const marker of MARKERS) {
          if (marker.token.test(line)) {
            push(
              draft(ctx, {
                path: file.node.relativePath,
                fileId: file.node.id,
                line: lineNo,
                category: 'correctness',
                ruleId: marker.ruleId,
                title: marker.title,
                description: `Line ${lineNo} contains a leftover task marker.`,
                severity: 'info',
                confidence: 'high',
                source: 'analyzer',
                evidence: [
                  {
                    kind: 'code-excerpt',
                    summary: line.trim().slice(0, 160),
                    ref: `${file.node.relativePath}:${lineNo}`,
                    confidence: 'high',
                  },
                ],
                relatedFiles: [],
                relatedSymbols: [],
              }),
            );
            break;
          }
        }
        if (file.node.language === 'typescript' || file.node.language === 'javascript') {
          for (const debug of DEBUG_PATTERNS) {
            if (debug.pattern.test(line)) {
              push(
                draft(ctx, {
                  path: file.node.relativePath,
                  fileId: file.node.id,
                  line: lineNo,
                  category: 'correctness',
                  ruleId: debug.ruleId,
                  title: debug.title,
                  description: `Line ${lineNo} writes to the console or breaks into the debugger. Remove before merging.`,
                  severity: 'low',
                  confidence: 'high',
                  source: 'analyzer',
                  evidence: [
                    {
                      kind: 'code-excerpt',
                      summary: line.trim().slice(0, 160),
                      ref: `${file.node.relativePath}:${lineNo}`,
                      confidence: 'high',
                    },
                  ],
                  relatedFiles: [],
                  relatedSymbols: [],
                }),
              );
              break;
            }
          }
        }
        if (line.length > LONG_LINE_CHARS) {
          push(
            draft(ctx, {
              path: file.node.relativePath,
              fileId: file.node.id,
              line: lineNo,
              category: 'style',
              ruleId: 'syntax.long-line',
              title: `Very long line (${line.length} chars)`,
              description: `Line ${lineNo} is ${line.length} characters wide, which hurts reviewability.`,
              severity: 'info',
              confidence: 'high',
              source: 'analyzer',
              evidence: [
                {
                  kind: 'analyzer',
                  summary: `Length ${line.length} exceeds ${LONG_LINE_CHARS}.`,
                  analyzerId: 'syntax',
                  confidence: 'high',
                },
              ],
              relatedFiles: [],
              relatedSymbols: [],
            }),
          );
        }
      });
    }
    return { ...emptyResult('syntax', scanned, Date.now() - started), findings };
  }
}
