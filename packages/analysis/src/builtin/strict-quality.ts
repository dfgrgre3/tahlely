import type { FindingCategory, NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, textLines, throwIfAborted } from './common.js';

interface StrictRule {
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  category: FindingCategory;
  pattern: RegExp;
  languages: 'js' | 'py' | 'shell' | 'any';
  recommendation: string;
  /** Deterministic single-line rewrite, when safe. */
  fix?: (line: string) => string;
}

/**
 * Strict per-line rules. High-signal only: every rule ships a recommendation
 * and, where the rewrite is deterministic, a suggestedFix.
 */
const RULES: StrictRule[] = [
  {
    ruleId: 'strict-quality.debugger',
    title: 'debugger statement left in code',
    description: 'A debugger statement pauses execution in production builds.',
    severity: 'high',
    category: 'correctness',
    pattern: /\bdebugger\s*;?/,
    languages: 'js',
    recommendation: 'Remove the debugger statement.',
    fix: (line) => line.replace(/\bdebugger\s*;?/, '').trimEnd(),
  },
  {
    ruleId: 'strict-quality.console-log',
    title: 'Debug console output',
    description: 'console.* calls leak internals and bypass log levels.',
    severity: 'low',
    category: 'style',
    pattern: /\bconsole\.(log|debug|info|warn)\s*\(/,
    languages: 'js',
    recommendation: 'Use a structured logger with levels, or remove before shipping.',
    fix: (line) => line.replace(/\bconsole\.(log|debug|info|warn)\b/, 'logger.debug'),
  },
  {
    ruleId: 'strict-quality.var-declaration',
    title: 'var declaration',
    description: 'var is function-scoped and hoisted; a common source of subtle bugs.',
    severity: 'medium',
    category: 'correctness',
    pattern: /\bvar\s+[A-Za-z_$]/,
    languages: 'js',
    recommendation: 'Use const (default) or let when reassignment is needed.',
    fix: (line) => line.replace(/\bvar\s+/, 'const '),
  },
  {
    ruleId: 'strict-quality.loose-equality',
    title: 'Loose equality (== / !=)',
    description: 'Loose equality coerces types ("0" == 0 is true) and hides bugs.',
    severity: 'medium',
    category: 'correctness',
    pattern: /[^=!<>]==[^=]|[^=!]!=[^=]/,
    languages: 'js',
    recommendation: 'Use === / !== and convert types explicitly.',
    fix: (line) =>
      line.replace(/([^=!<>])==([^=])/, '$1===$2').replace(/([^=!])!=([^=])/, '$1!==$2'),
  },
  {
    ruleId: 'strict-quality.explicit-any',
    title: 'Explicit any type',
    description: 'any disables type checking for this value and everything it touches.',
    severity: 'medium',
    category: 'correctness',
    pattern: /(:\s*any\b|\bas\s+any\b|<any>)/,
    languages: 'js',
    recommendation: 'Replace any with unknown + narrowing, or a precise type.',
  },
  {
    ruleId: 'strict-quality.ts-suppress',
    title: 'TypeScript/lint suppression comment',
    description:
      '@ts-ignore / @ts-nocheck / eslint-disable silence the compiler instead of fixing the issue.',
    severity: 'medium',
    category: 'correctness',
    pattern: /@ts-(ignore|nocheck|expect-error)|eslint-disable/,
    languages: 'js',
    recommendation: 'Fix the underlying type/lint error instead of suppressing it.',
  },
  {
    ruleId: 'strict-quality.empty-catch',
    title: 'Empty catch block',
    description: 'Swallowed exceptions make failures invisible.',
    severity: 'high',
    category: 'correctness',
    pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/,
    languages: 'js',
    recommendation: 'Log the error, add context, and rethrow or recover explicitly.',
  },
  {
    ruleId: 'strict-quality.throw-literal',
    title: 'Throwing a non-Error value',
    description: 'Thrown strings/objects lose stack traces and break error handling.',
    severity: 'medium',
    category: 'correctness',
    pattern: /\bthrow\s+['"`{[]/,
    languages: 'js',
    recommendation: 'Throw an Error (or subclass) with a descriptive message.',
  },
  {
    ruleId: 'strict-quality.new-function',
    title: 'new Function() dynamic code',
    description: 'new Function() is eval in disguise — arbitrary code execution.',
    severity: 'high',
    category: 'security',
    pattern: /\bnew\s+Function\s*\(/,
    languages: 'js',
    recommendation: 'Replace with a safe parser or precompiled function map.',
  },
  {
    ruleId: 'strict-quality.hardcoded-ip',
    title: 'Hardcoded IP address',
    description: 'A literal IP in source breaks when infrastructure changes and may leak topology.',
    severity: 'low',
    category: 'configuration',
    pattern: /['"]\d{1,3}(\.\d{1,3}){3}(:\d+)?['"]/,
    languages: 'any',
    recommendation: 'Move hosts/IPs to configuration or environment variables.',
  },
  {
    ruleId: 'strict-quality.todo-marker',
    title: 'Unresolved TODO/FIXME/HACK',
    description: 'Marker comments indicate known unfinished or fragile work.',
    severity: 'info',
    category: 'style',
    pattern: /\b(TODO|FIXME|HACK|XXX)\b/,
    languages: 'any',
    recommendation: 'Track the work in an issue and link it, or resolve it.',
  },
  {
    ruleId: 'strict-quality.py-bare-except',
    title: 'Bare except clause',
    description: 'except: catches KeyboardInterrupt and SystemExit, hiding fatal signals.',
    severity: 'high',
    category: 'correctness',
    pattern: /^\s*except\s*:/,
    languages: 'py',
    recommendation: 'Catch specific exceptions (at minimum `except Exception:`).',
    fix: (line) => line.replace(/except\s*:/, 'except Exception:'),
  },
  {
    ruleId: 'strict-quality.py-mutable-default',
    title: 'Mutable default argument',
    description: 'Default lists/dicts are shared across calls — a classic Python bug.',
    severity: 'high',
    category: 'correctness',
    pattern: /def\s+\w+\([^)]*=\s*(\[\]|\{\})/,
    languages: 'py',
    recommendation: 'Default to None and create the object inside the function.',
  },
  {
    ruleId: 'strict-quality.py-os-system',
    title: 'os.system shell call',
    description: 'os.system runs through the shell — injection risk and no output capture.',
    severity: 'high',
    category: 'security',
    pattern: /\bos\.system\s*\(/,
    languages: 'py',
    recommendation: 'Use subprocess.run([...], shell=False) with an argument list.',
  },
  {
    ruleId: 'strict-quality.py-pickle-loads',
    title: 'pickle deserialization',
    description: 'pickle.loads on untrusted data executes arbitrary code.',
    severity: 'critical',
    category: 'security',
    pattern: /\bpickle\.loads?\s*\(/,
    languages: 'py',
    recommendation: 'Use JSON for untrusted data; only unpickle trusted sources.',
  },
  {
    ruleId: 'strict-quality.shell-pipe-exec',
    title: 'Piped remote execution (curl | sh)',
    description: 'Executing a downloaded script sight-unseen is a supply-chain risk.',
    severity: 'high',
    category: 'security',
    pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(bash|sh)\b/,
    languages: 'any',
    recommendation: 'Download, verify checksum/signature, review, then execute.',
  },
];

const MAX_PER_FILE = 25;
const LONG_FILE_LINES = 400;
const LONG_FUNCTION_LINES = 60;
const MAX_NESTING_DEPTH = 5;
const LONG_LINE_CHARS = 140;

type RuleLang = 'js' | 'py' | 'shell' | 'other';

function familyOf(node: { extension: string }): RuleLang {
  const extension = normalizedExtension(node);
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(extension)) return 'js';
  if (extension === 'py') return 'py';
  if (['sh', 'bash', 'zsh'].includes(extension)) return 'shell';
  return 'other';
}

function applies(rule: StrictRule, family: RuleLang): boolean {
  return rule.languages === 'any' || rule.languages === family;
}

/**
 * Strict quality analyzer: per-line rules (exact line numbers + suggested
 * fixes where deterministic) plus structural checks — over-long files,
 * over-long functions (brace tracking), nesting depth, async-without-await.
 */
export class StrictQualityAnalyzer implements Analyzer {
  readonly kind = 'strict-quality' as const;
  readonly rulePrefix = 'strict-quality.';
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
      const family = familyOf(file.node);
      let perFile = 0;
      const push = (partial: Parameters<typeof draft>[1]): void => {
        if (perFile >= MAX_PER_FILE) return;
        perFile += 1;
        findings.push(draft(ctx, partial));
      };

      lines.forEach((line, index) => {
        const lineNo = index + 1;
        for (const rule of RULES) {
          if (!applies(rule, family) || !rule.pattern.test(line)) continue;
          push({
            path: file.node.relativePath,
            fileId: file.node.id,
            line: lineNo,
            category: rule.category,
            ruleId: rule.ruleId,
            title: rule.title,
            description: `${rule.description} (${file.node.relativePath}:${lineNo})`,
            severity: rule.severity,
            confidence: rule.fix ? 'high' : 'medium',
            source: 'analyzer',
            evidence: [
              {
                kind: 'code-excerpt',
                summary: line.trim().slice(0, 200),
                ref: `${file.node.relativePath}:${lineNo}`,
                analyzerId: 'strict-quality',
                confidence: rule.fix ? 'high' : 'medium',
              },
            ],
            recommendation: rule.recommendation,
            suggestedFix: rule.fix?.(line),
            relatedFiles: [],
            relatedSymbols: [],
          });
          break;
        }
        if (line.length > LONG_LINE_CHARS) {
          push({
            path: file.node.relativePath,
            fileId: file.node.id,
            line: lineNo,
            category: 'style',
            ruleId: 'strict-quality.long-line',
            title: `Line exceeds ${LONG_LINE_CHARS} characters`,
            description: `Long lines hurt readability and review (${file.node.relativePath}:${lineNo}).`,
            severity: 'info',
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Split the expression or extract well-named helpers.',
            relatedFiles: [],
            relatedSymbols: [],
          });
        }
      });
      this.structuralChecks(file.node, lines, push);
    }
    return { ...emptyResult('strict-quality', scanned, Date.now() - started), findings };
  }

  private structuralChecks(
    node: AnalyzerContext['files'][number]['node'],
    lines: string[],
    push: (partial: Omit<NewFinding, 'projectId' | 'analysisId'>) => void,
  ): void {
    if (lines.length > LONG_FILE_LINES) {
      push({
        path: node.relativePath,
        fileId: node.id,
        line: 1,
        category: 'architecture',
        ruleId: 'strict-quality.long-file',
        title: `File exceeds ${LONG_FILE_LINES} lines`,
        description: `${node.relativePath} has ${lines.length} lines — likely multiple responsibilities.`,
        severity: 'medium',
        confidence: 'high',
        source: 'analyzer',
        evidence: [],
        recommendation: 'Split by responsibility into focused modules.',
        relatedFiles: [],
        relatedSymbols: [],
      });
    }

    // Brace tracking: function length + nesting depth (brace-style blocks).
    let depth = 0;
    const stack: { startLine: number; depth: number; label: string }[] = [];
    lines.forEach((line, index) => {
      const lineNo = index + 1;
      const fnMatch =
        /\bfunction\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/.exec(
          line,
        );
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      if (fnMatch) {
        stack.push({
          startLine: lineNo,
          depth: depth + Math.max(1, opens),
          label: fnMatch[1] ?? fnMatch[2] ?? 'anonymous',
        });
      }
      depth += opens - closes;
      if (depth > MAX_NESTING_DEPTH) {
        push({
          path: node.relativePath,
          fileId: node.id,
          line: lineNo,
          category: 'style',
          ruleId: 'strict-quality.deep-nesting',
          title: `Nesting deeper than ${MAX_NESTING_DEPTH} levels`,
          description: `Deep nesting (${node.relativePath}:${lineNo}) makes control flow hard to follow.`,
          severity: 'low',
          confidence: 'high',
          source: 'analyzer',
          evidence: [],
          recommendation: 'Use early returns / guard clauses or extract nested blocks.',
          relatedFiles: [],
          relatedSymbols: [],
        });
      }
      while (stack.length > 0 && depth < stack[stack.length - 1]!.depth) {
        const fn = stack.pop()!;
        const length = lineNo - fn.startLine;
        if (length > LONG_FUNCTION_LINES) {
          push({
            path: node.relativePath,
            fileId: node.id,
            line: fn.startLine,
            category: 'architecture',
            ruleId: 'strict-quality.long-function',
            title: `Function ${fn.label} spans ${length} lines`,
            description: `Over-long function in ${node.relativePath}:${fn.startLine}.`,
            severity: 'medium',
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Extract cohesive blocks into smaller named functions.',
            relatedFiles: [],
            relatedSymbols: [fn.label],
          });
        }
      }
    });

    // async without await (file-level heuristic, one finding).
    const asyncIndex = lines.findIndex((line) => /\basync\b/.test(line));
    if (asyncIndex >= 0 && !lines.some((line) => /\bawait\b/.test(line))) {
      push({
        path: node.relativePath,
        fileId: node.id,
        line: asyncIndex + 1,
        category: 'correctness',
        ruleId: 'strict-quality.async-without-await',
        title: 'async declared but no await in file',
        description: `${node.relativePath}:${asyncIndex + 1} — async without await adds overhead and hides sync errors.`,
        severity: 'low',
        confidence: 'medium',
        source: 'analyzer',
        evidence: [],
        recommendation: 'Await the async work, or drop the async keyword.',
        relatedFiles: [],
        relatedSymbols: [],
      });
    }
  }
}
