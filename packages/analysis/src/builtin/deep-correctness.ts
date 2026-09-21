import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from './common.js';

const MAX_PER_FILE = 30;
const JS_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

const PY_BUILTINS = new Set([
  'print',
  'len',
  'range',
  'open',
  'str',
  'int',
  'float',
  'bool',
  'list',
  'dict',
  'set',
  'tuple',
  'enumerate',
  'zip',
  'map',
  'filter',
  'sorted',
  'sum',
  'min',
  'max',
  'abs',
  'all',
  'any',
  'isinstance',
  'issubclass',
  'hasattr',
  'getattr',
  'setattr',
  'delattr',
  'type',
  'id',
  'hash',
  'repr',
  'input',
  'super',
  'round',
  'pow',
  'divmod',
  'ord',
  'chr',
  'hex',
  'oct',
  'bin',
  'bytes',
  'bytearray',
  'memoryview',
  'iter',
  'next',
  'reversed',
  'slice',
  'vars',
  'dir',
  'globals',
  'locals',
  'callable',
  'format',
  'object',
  'property',
  'staticmethod',
  'classmethod',
  'Exception',
  'ValueError',
  'TypeError',
  'KeyError',
  'IndexError',
  'AttributeError',
  'RuntimeError',
  'StopIteration',
  'NotImplementedError',
  'BaseException',
  'True',
  'False',
  'None',
  '__name__',
  '__main__',
  '__file__',
]);
const PY_KEYWORDS = new Set([
  'def',
  'class',
  'if',
  'elif',
  'else',
  'for',
  'while',
  'with',
  'as',
  'return',
  'import',
  'from',
  'try',
  'except',
  'finally',
  'raise',
  'assert',
  'del',
  'global',
  'nonlocal',
  'pass',
  'lambda',
  'not',
  'and',
  'or',
  'in',
  'is',
  'await',
  'async',
  'yield',
]);

/**
 * Python-aware blanking: removes # comments and string contents (including
 * triple-quoted blocks) while preserving line structure, so indentation
 * analysis and regex checks never see code inside strings.
 */
function pyBlank(content: string): { lines: string[]; raw: string[] } {
  const raw = content.split('\n');
  const out: string[] = [];
  let triple: string | null = null;
  for (const source of raw) {
    let code = '';
    let i = 0;
    let quote: string | null = null;
    while (i < source.length) {
      const ch = source[i]!;
      const three = source.slice(i, i + 3);
      if (triple) {
        if (three === triple) {
          triple = null;
          i += 3;
        } else {
          i += 1;
        }
        continue;
      }
      if (quote) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (three === "'''" || three === '"""') {
        triple = three;
        i += 3;
        continue;
      }
      if (ch === '#') break;
      if (ch === '"' || ch === "'") {
        quote = ch;
        i += 1;
        continue;
      }
      code += ch;
      i += 1;
    }
    out.push(code);
  }
  return { lines: out, raw };
}

interface PyImport {
  name: string;
  line: number;
}

function pyCollectImports(lines: string[]): PyImport[] {
  const out: PyImport[] = [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const fromImport = /^\s*from\s+[\w.]+\s+import\s+(.+)$/.exec(line);
    if (fromImport) {
      const names = fromImport[1]!.replace(/[()]/g, '').split(',');
      for (const piece of names) {
        const parts = piece.trim().split(/\s+as\s+/);
        const name = (parts[1] ?? parts[0] ?? '').trim().split('.')[0] ?? '';
        if (/^[A-Za-z_]\w*$/.test(name) && name !== '*') out.push({ name, line: lineNo });
      }
      return;
    }
    const plain = /^\s*import\s+(.+)$/.exec(line);
    if (plain) {
      for (const piece of plain[1]!.split(',')) {
        const parts = piece.trim().split(/\s+as\s+/);
        const dotted = (parts[1] ?? parts[0] ?? '').trim();
        const name = dotted.split('.')[0] ?? '';
        if (/^[A-Za-z_]\w*$/.test(name)) out.push({ name, line: lineNo });
      }
    }
  });
  return out;
}

interface PyDef {
  name: string;
  line: number;
  /** Positional params the caller must/can pass (accounting for defaults). */
  required: number;
  total: number;
  /** True when *args/**kwargs accept anything — arity cannot be checked. */
  variadic: boolean;
}

function pyCollectDefs(lines: string[]): PyDef[] {
  const out: PyDef[] = [];
  const pattern = /^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  lines.forEach((line, index) => {
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (!match) return;
    let params = (match[2] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && part !== '/' && part !== '*');
    if (params[0] === 'self' || params[0] === 'cls') params = params.slice(1);
    const variadic = params.some((part) => part.startsWith('*'));
    const required = params.filter((part) => !part.includes('=') && !part.startsWith('*')).length;
    out.push({ name: match[1]!, line: index + 1, required, total: params.length, variadic });
  });
  return out;
}

function pyIndentOf(line: string): number {
  const match = /^(\s*)/.exec(line);
  return match?.[1]?.length ?? 0;
}

const JS_GLOBALS = new Set([
  'console',
  'window',
  'document',
  'globalThis',
  'process',
  'require',
  'module',
  'exports',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Math',
  'JSON',
  'Date',
  'RegExp',
  'Error',
  'TypeError',
  'RangeError',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Symbol',
  'BigInt',
  'Proxy',
  'Reflect',
  'Intl',
  'Function',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
  'fetch',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'localStorage',
  'sessionStorage',
  'structuredClone',
  'AbortController',
  'AbortSignal',
  'btoa',
  'atob',
  'crypto',
  'performance',
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'new',
  'delete',
  'void',
  'in',
  'of',
  'function',
  'class',
  'await',
  'async',
  'yield',
  'super',
  'this',
  'do',
  'else',
  'try',
  'finally',
  'throw',
  'case',
  'default',
  'break',
  'continue',
  'const',
  'let',
  'var',
  'import',
  'export',
  'extends',
  'instanceof',
  'null',
  'undefined',
  'true',
  'false',
]);

interface CodeScan {
  /** Code with strings/comments blanked out; same line structure as source. */
  code: string;
  lines: string[];
  /** Original lines — needed to read import specifiers that live in strings. */
  rawLines: string[];
  findings: Omit<NewFinding, 'projectId' | 'analysisId'>[];
}

function finding(
  node: AnalyzerContext['files'][number]['node'],
  partial: Omit<
    NewFinding,
    | 'projectId'
    | 'analysisId'
    | 'path'
    | 'fileId'
    | 'relatedFiles'
    | 'relatedSymbols'
    | 'source'
    | 'evidence'
  > & {
    evidence?: NewFinding['evidence'];
    relatedSymbols?: NewFinding['relatedSymbols'];
  },
): Omit<NewFinding, 'projectId' | 'analysisId'> {
  return {
    path: node.relativePath,
    fileId: node.id,
    source: 'analyzer',
    relatedFiles: [],
    ...partial,
    evidence: partial.evidence ?? [],
    relatedSymbols: partial.relatedSymbols ?? [],
  };
}

/**
 * Lexer-lite scan: blanks string contents and comments while preserving line
 * structure, and reports unterminated strings / block comments with the exact
 * opening line. Everything downstream operates on this sanitized text, so
 * regex checks never match inside strings or comments.
 */
function scanCode(node: AnalyzerContext['files'][number]['node'], content: string): CodeScan {
  const lines = content.split('\n');
  const findings: CodeScan['findings'] = [];
  let inBlockComment = false;
  let blockStart = 0;
  const outLines: string[] = [];

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    let code = '';
    let i = 0;
    let quote: string | null = null;
    let quoteStart = 0;
    while (i < raw.length) {
      const ch = raw[i]!;
      const next = raw[i + 1];
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      if (quote) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        blockStart = lineNo;
        i += 2;
        continue;
      }
      if (ch === '/' && next === '/') break;
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        quoteStart = lineNo;
        i += 1;
        continue;
      }
      code += ch;
      i += 1;
    }
    if (quote) {
      findings.push(
        finding(node, {
          line: quoteStart,
          category: 'correctness',
          ruleId: 'deep-correctness.unterminated-string',
          title: 'Unterminated string literal',
          description: `A string opened on line ${quoteStart} is never closed — this is a syntax error.`,
          severity: 'critical',
          confidence: 'high',
          recommendation: 'Close the string literal or escape the line break.',
        }),
      );
    }
    outLines.push(code);
  });

  if (inBlockComment) {
    findings.push(
      finding(node, {
        line: blockStart,
        category: 'correctness',
        ruleId: 'deep-correctness.unterminated-comment',
        title: 'Unterminated block comment',
        description: `A block comment opened on line ${blockStart} is never closed — the rest of the file is commented out.`,
        severity: 'critical',
        confidence: 'high',
        recommendation: 'Close the comment with */.',
      }),
    );
  }
  return { code: outLines.join('\n'), lines: outLines, rawLines: lines, findings };
}

/** Bracket matching over sanitized code — catches real syntax breakage. */
function checkBrackets(
  node: AnalyzerContext['files'][number]['node'],
  lines: string[],
): Omit<NewFinding, 'projectId' | 'analysisId'>[] {
  const findings: Omit<NewFinding, 'projectId' | 'analysisId'>[] = [];
  const openers = new Map([
    ['{', '}'],
    ['(', ')'],
    ['[', ']'],
  ]);
  const closers = new Map([
    ['}', '{'],
    [')', '('],
    [']', '['],
  ]);
  const stack: { ch: string; line: number }[] = [];
  lines.forEach((line, index) => {
    for (const ch of line) {
      if (openers.has(ch)) stack.push({ ch, line: index + 1 });
      else if (closers.has(ch)) {
        const expected = closers.get(ch)!;
        const top = stack[stack.length - 1];
        if (!top) {
          findings.push(
            finding(node, {
              line: index + 1,
              category: 'correctness',
              ruleId: 'deep-correctness.unmatched-closing-bracket',
              title: `Unmatched closing '${ch}'`,
              description: `Line ${index + 1} closes '${ch}' but nothing was opened — the file does not parse.`,
              severity: 'critical',
              confidence: 'high',
              recommendation: 'Remove the extra bracket or restore the missing opener.',
            }),
          );
        } else if (top.ch !== expected) {
          findings.push(
            finding(node, {
              line: index + 1,
              category: 'correctness',
              ruleId: 'deep-correctness.mismatched-bracket',
              title: `Mismatched bracket: '${top.ch}' opened on line ${top.line} closed by '${ch}'`,
              description: `Line ${index + 1} closes '${ch}' while '${top.ch}' from line ${top.line} is still open — unbalanced blocks break parsing.`,
              severity: 'critical',
              confidence: 'high',
              recommendation: 'Fix the bracket pair so every block closes in order.',
            }),
          );
          stack.pop();
        } else {
          stack.pop();
        }
      }
    }
  });
  for (const leftover of stack) {
    findings.push(
      finding(node, {
        line: leftover.line,
        category: 'correctness',
        ruleId: 'deep-correctness.unclosed-bracket',
        title: `Unclosed '${leftover.ch}'`,
        description: `'${leftover.ch}' opened on line ${leftover.line} is never closed — the file does not parse.`,
        severity: 'critical',
        confidence: 'high',
        recommendation: 'Close the block or remove the stray opener.',
      }),
    );
  }
  return findings;
}

interface ImportedName {
  name: string;
  line: number;
  specifier: string;
}

function collectImports(lines: string[]): ImportedName[] {
  const out: ImportedName[] = [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const named = /\bimport\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"])/.exec(line);
    if (named) {
      for (const piece of named[1]!.split(',')) {
        const parts = piece.trim().split(/\s+as\s+/);
        const name = (parts[1] ?? parts[0] ?? '').trim();
        if (name) out.push({ name, line: lineNo, specifier: named[2]! });
      }
      return;
    }
    const defaultImport =
      /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*['"]([^'"]+)['"]/.exec(line);
    if (defaultImport) {
      out.push({ name: defaultImport[1]!, line: lineNo, specifier: defaultImport[2]! });
      const extra = /\{([^}]*)\}/.exec(line);
      if (extra) {
        for (const piece of extra[1]!.split(',')) {
          const name = (
            piece.trim().split(/\s+as\s+/)[1] ??
            piece.trim().split(/\s+as\s+/)[0] ??
            ''
          ).trim();
          if (name) out.push({ name, line: lineNo, specifier: defaultImport[2]! });
        }
      }
      return;
    }
    const namespace = /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/.exec(
      line,
    );
    if (namespace) out.push({ name: namespace[1]!, line: lineNo, specifier: namespace[2]! });
  });
  return out;
}

function countUsages(lines: string[], name: string, skipLine: number): number {
  const pattern = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g');
  let count = 0;
  lines.forEach((line, index) => {
    if (index + 1 === skipLine) return;
    count += line.match(pattern)?.length ?? 0;
  });
  return count;
}

/** Word-boundary usage counter for Python names (dotted usage counts too). */
function countPyUsages(lines: string[], name: string, skipLine: number): number {
  const pattern = new RegExp(`\\b${name}\\b`, 'g');
  let count = 0;
  lines.forEach((line, index) => {
    if (index + 1 === skipLine) return;
    const cleaned = line.replace(/^\s*(import|from)\b.*$/, '');
    count += cleaned.match(pattern)?.length ?? 0;
  });
  return count;
}

function declaredNames(lines: string[]): Map<string, number> {
  const declared = new Map<string, number>();
  lines.forEach((line, index) => {
    const patterns = [
      /\bfunction\s+([A-Za-z_$][\w$]*)/g,
      /\bclass\s+([A-Za-z_$][\w$]*)/g,
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
      /\b(?:const|let|var)\s*\{([^}]*)\}/g,
    ];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        for (const raw of (match[1] ?? '').split(',')) {
          const name = raw.trim().split(/[:=]/)[0]?.trim() ?? '';
          if (/^[A-Za-z_$][\w$]*$/.test(name) && !declared.has(name)) {
            declared.set(name, index + 1);
          }
        }
      }
    }
  });
  return declared;
}

function functionRanges(lines: string[]): { start: number; end: number; isAsync: boolean }[] {
  const ranges: { start: number; end: number; isAsync: boolean }[] = [];
  let depth = 0;
  const open: { start: number; depth: number; isAsync: boolean }[] = [];
  lines.forEach((line, index) => {
    const isFn = /\bfunction\b|=>\s*\{|\)\s*\{/.test(line);
    const isAsync = /\basync\b/.test(line);
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (isFn && opens > 0) open.push({ start: index + 1, depth: depth + opens, isAsync });
    depth += opens - closes;
    while (open.length > 0 && depth < open[open.length - 1]!.depth) {
      const fn = open.pop()!;
      ranges.push({ start: fn.start, end: index + 1, isAsync: fn.isAsync });
    }
  });
  for (const fn of open) ranges.push({ start: fn.start, end: lines.length, isAsync: fn.isAsync });
  return ranges;
}

/**
 * Deep deterministic correctness analyzer. Operates on sanitized code
 * (strings/comments removed) so results are real, not textual coincidences.
 */
export class DeepCorrectnessAnalyzer implements Analyzer {
  readonly kind = 'deep-correctness' as const;
  readonly rulePrefix = 'deep-correctness.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated) continue;
      const ext = normalizedExtension(file.node);
      if (!JS_EXTENSIONS.includes(ext) && ext !== 'py') continue;
      if (file.content === undefined) continue;
      scanned += 1;
      const perFile: Omit<NewFinding, 'projectId' | 'analysisId'>[] = [];
      if (ext === 'py') {
        perFile.push(...this.pythonChecks(file.node, file.content));
        findings.push(...perFile.slice(0, MAX_PER_FILE).map((item) => draft(ctx, item)));
        continue;
      }
      const scan = scanCode(file.node, file.content);
      perFile.push(...scan.findings, ...checkBrackets(file.node, scan.lines));

      const imports = collectImports(scan.rawLines);
      for (const imported of imports) {
        if (countUsages(scan.lines, imported.name, imported.line) === 0) {
          perFile.push(
            finding(file.node, {
              line: imported.line,
              category: 'dead-code',
              ruleId: 'deep-correctness.unused-import',
              title: `Unused import: ${imported.name}`,
              description: `'${imported.name}' is imported from ${imported.specifier} but never used in ${file.node.relativePath}.`,
              severity: 'medium',
              confidence: 'high',
              recommendation: 'Remove the unused import (or use it).',
            }),
          );
        }
      }

      const declared = declaredNames(scan.lines);
      for (const imported of imports) declared.set(imported.name, imported.line);
      perFile.push(...this.entryLocalChecks(file.node, scan.lines, declared));

      // await outside an async function.
      const ranges = functionRanges(scan.lines);
      scan.lines.forEach((line, index) => {
        if (!/\bawait\b/.test(line)) return;
        const lineNo = index + 1;
        const enclosing = ranges.find((range) => lineNo >= range.start && lineNo <= range.end);
        if (!enclosing || !enclosing.isAsync) {
          perFile.push(
            finding(file.node, {
              line: lineNo,
              category: 'correctness',
              ruleId: 'deep-correctness.await-outside-async',
              title: 'await used outside an async function',
              description: `Line ${lineNo} awaits outside any async function — a syntax error in scripts and a silent bug in sync callbacks.`,
              severity: 'high',
              confidence: 'medium',
              recommendation: 'Move the await into an async function or drop it.',
            }),
          );
        }
      });

      findings.push(...perFile.slice(0, MAX_PER_FILE).map((item) => draft(ctx, item)));
    }
    return { ...emptyResult('deep-correctness', scanned, Date.now() - started), findings };
  }

  private entryLocalChecks(
    node: AnalyzerContext['files'][number]['node'],
    lines: string[],
    declared: Map<string, number>,
  ): Omit<NewFinding, 'projectId' | 'analysisId'>[] {
    const perFile: Omit<NewFinding, 'projectId' | 'analysisId'>[] = [];

    // Undefined identifiers: called names never declared or imported.
    const called = new Set<string>();
    lines.forEach((line, index) => {
      const pattern = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const name = match[1]!;
        if (JS_GLOBALS.has(name) || declared.has(name) || called.has(name)) continue;
        called.add(name);
        perFile.push(
          finding(node, {
            line: index + 1,
            category: 'correctness',
            ruleId: 'deep-correctness.undefined-identifier',
            title: `Call to undefined '${name}'`,
            description: `Line ${index + 1} calls ${name}() but it is not declared here, not imported, and not a known global — likely a ReferenceError or a missing import.`,
            severity: 'high',
            confidence: 'medium',
            recommendation: `Import ${name} or declare it before use.`,
            relatedSymbols: [name],
          }),
        );
      }
    });

    const seen = new Map<string, number>();
    lines.forEach((line, index) => {
      const pattern = /\b(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const name = match[1]!;
        const first = seen.get(name);
        if (first !== undefined) {
          perFile.push(
            finding(node, {
              line: index + 1,
              category: 'correctness',
              ruleId: 'deep-correctness.duplicate-declaration',
              title: `Duplicate declaration: ${name}`,
              description: `'${name}' is declared again on line ${index + 1}; it was already declared on line ${first} — the later one shadows the first.`,
              severity: 'high',
              confidence: 'high',
              recommendation: 'Rename one of them or remove the duplicate.',
              relatedSymbols: [name],
            }),
          );
        } else {
          seen.set(name, index + 1);
        }
      }
    });

    lines.forEach((line, index) => {
      const condition = /\b(?:if|while)\s*\(([^)]*)\)/.exec(line);
      const body = condition?.[1];
      if (body && /(^|[^=!<>])=(?!=)/.test(body) && !/=>/.test(body)) {
        perFile.push(
          finding(node, {
            line: index + 1,
            category: 'correctness',
            ruleId: 'deep-correctness.assignment-in-condition',
            title: 'Assignment inside condition',
            description: `Line ${index + 1} assigns inside the condition (${body.trim()}) — usually a mistyped comparison.`,
            severity: 'high',
            confidence: 'high',
            recommendation:
              'Use === for comparisons; if assignment is intended, wrap it in extra parentheses.',
          }),
        );
      }
      if (/[=!]==?\s*NaN\b|\bNaN\s*[=!]==?/.test(line)) {
        perFile.push(
          finding(node, {
            line: index + 1,
            category: 'correctness',
            ruleId: 'deep-correctness.nan-comparison',
            title: 'Comparison with NaN is always false',
            description: `Line ${index + 1} compares against NaN directly; NaN never equals itself.`,
            severity: 'high',
            confidence: 'high',
            recommendation: 'Use Number.isNaN(value).',
          }),
        );
      }
      if (/\b([A-Za-z_$][\w$]*)\s*=\s*\1\s*;/.test(line)) {
        perFile.push(
          finding(node, {
            line: index + 1,
            category: 'correctness',
            ruleId: 'deep-correctness.self-assignment',
            title: 'Self-assignment has no effect',
            description: `Line ${index + 1} assigns a variable to itself.`,
            severity: 'medium',
            confidence: 'high',
            recommendation: 'Assign the intended source value or remove the statement.',
          }),
        );
      }
    });
    return perFile;
  }

  /**
   * Python deep checks over blanked code: indentation integrity, unused
   * imports, undefined names, call arity mismatch, inconsistent returns,
   * and print() left in code.
   */
  private pythonChecks(
    node: AnalyzerContext['files'][number]['node'],
    content: string,
  ): Omit<NewFinding, 'projectId' | 'analysisId'>[] {
    const perFile: Omit<NewFinding, 'projectId' | 'analysisId'>[] = [];
    const blanked = pyBlank(content);
    const lines = blanked.lines;
    const raw = blanked.raw;

    // Indentation integrity: unexpected dedents + mixed tabs/spaces.
    const indentStack = [0];
    let sawSpacesIndent = false;
    lines.forEach((line, index) => {
      const lineNo = index + 1;
      if (line.trim().length === 0) return;
      const indent = pyIndentOf(line);
      const leading = line.slice(0, indent);
      const usesTabs = /^\t/.test(leading);
      if (!usesTabs && indent > 0) sawSpacesIndent = true;
      if (usesTabs && sawSpacesIndent) {
        perFile.push(
          finding(node, {
            line: lineNo,
            category: 'correctness',
            ruleId: 'deep-correctness.py-mixed-indentation',
            title: 'Mixed tabs and spaces for indentation',
            description: `Line ${lineNo} uses tabs while other lines use spaces — Python 3 raises TabError and execution becomes ambiguous.`,
            severity: 'high',
            confidence: 'high',
            recommendation: 'Use spaces only (PEP 8: 4 spaces per level) throughout the file.',
          }),
        );
        sawSpacesIndent = false;
      }
      if (indent > indentStack[indentStack.length - 1]!) {
        indentStack.push(indent);
      } else {
        while (indentStack.length > 1 && indent < indentStack[indentStack.length - 1]!) {
          indentStack.pop();
        }
        if (indent !== indentStack[indentStack.length - 1]) {
          perFile.push(
            finding(node, {
              line: lineNo,
              category: 'correctness',
              ruleId: 'deep-correctness.py-bad-dedent',
              title: 'Unexpected dedent (indentation does not match any outer level)',
              description: `Line ${lineNo} dedents to a level that matches no open block — this is an IndentationError at runtime.`,
              severity: 'critical',
              confidence: 'high',
              recommendation: 'Re-indent the line to match one of the enclosing blocks.',
            }),
          );
          indentStack.length = 1;
        }
      }
    });
    perFile.push(...this.pythonNames(node, lines, raw));
    return perFile;
  }

  private pythonNames(
    node: AnalyzerContext['files'][number]['node'],
    lines: string[],
    raw: string[],
  ): Omit<NewFinding, 'projectId' | 'analysisId'>[] {
    const perFile: Omit<NewFinding, 'projectId' | 'analysisId'>[] = [];
    const imports = pyCollectImports(lines);
    const declared = new Set<string>();
    lines.forEach((line) => {
      const match = /^\s*(?:def|class)\s+([A-Za-z_]\w*)/.exec(line);
      if (match?.[1]) declared.add(match[1]);
      const assign = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=(?!=)/.exec(line);
      if (assign) {
        for (const name of assign[1]!.split(',')) {
          const trimmed = name.trim();
          if (/^[A-Za-z_]\w*$/.test(trimmed)) declared.add(trimmed);
        }
      }
    });
    for (const imp of imports) declared.add(imp.name);

    for (const imp of imports) {
      if (countPyUsages(lines, imp.name, imp.line) === 0) {
        perFile.push(
          finding(node, {
            line: imp.line,
            category: 'dead-code',
            ruleId: 'deep-correctness.py-unused-import',
            title: `Unused import: ${imp.name}`,
            description: `'${imp.name}' is imported on line ${imp.line} but never used in ${node.relativePath}.`,
            severity: 'medium',
            confidence: 'high',
            recommendation: 'Remove the unused import.',
          }),
        );
      }
    }

    const defs = pyCollectDefs(lines);
    const defByName = new Map(defs.map((def) => [def.name, def]));
    const called = new Set<string>();
    lines.forEach((line, index) => {
      const pattern = /(?:^|[^\w.])([A-Za-z_]\w*)\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const name = match[1]!;
        if (PY_KEYWORDS.has(name)) continue;
        const local = defByName.get(name);
        if (local) {
          // Argument counting reads the RAW line: blanked strings would hide
          // visible arguments (e.g. connect("db") has one argument).
          const rawLine = raw[index] ?? line;
          const rest = rawLine.slice(rawLine.indexOf(name, match.index) + name.length);
          const trimmed = rest.trim().startsWith('(') ? rest.trim().slice(1) : rest.trim();
          const argc =
            trimmed.length === 0 || trimmed.startsWith(')')
              ? 0
              : trimmed
                  .slice(0, rest.indexOf(')') >= 0 ? rest.indexOf(')') : rest.length)
                  .split(',').length;
          if (!local.variadic && (argc < local.required || argc > local.total)) {
            perFile.push(
              finding(node, {
                line: index + 1,
                category: 'correctness',
                ruleId: 'deep-correctness.py-arity-mismatch',
                title: `Wrong argument count calling ${name}()`,
                description: `Line ${index + 1} calls ${name}() with ${argc} argument(s), but it is defined with ${local.total} parameter(s) (${local.required} required) on line ${local.line} — a TypeError at runtime.`,
                severity: 'high',
                confidence: 'high',
                recommendation: `Call ${name} with a matching argument count or change its signature.`,
                relatedSymbols: [name],
              }),
            );
          }
          continue;
        }
        if (declared.has(name) || PY_BUILTINS.has(name) || called.has(name)) continue;
        called.add(name);
        perFile.push(
          finding(node, {
            line: index + 1,
            category: 'correctness',
            ruleId: 'deep-correctness.py-undefined-name',
            title: `Use of undefined name '${name}'`,
            description: `Line ${index + 1} calls ${name}() but it is not defined, imported, or a builtin in ${node.relativePath} — a NameError at runtime.`,
            severity: 'high',
            confidence: 'medium',
            recommendation: `Import ${name} or define it before use.`,
            relatedSymbols: [name],
          }),
        );
      }
    });

    // Inconsistent returns: bare `return` alongside `return <value>`.
    let blockStart = -1;
    let blockIndent = -1;
    let bareReturn = -1;
    let valuedReturn = -1;
    const checkBlock = (): void => {
      if (blockStart >= 0 && bareReturn >= 0 && valuedReturn >= 0) {
        perFile.push(
          finding(node, {
            line: bareReturn,
            category: 'correctness',
            ruleId: 'deep-correctness.py-inconsistent-return',
            title: 'Inconsistent return values (None vs value)',
            description: `The function starting on line ${blockStart} returns both None (line ${bareReturn}) and a value (line ${valuedReturn}) — callers cannot rely on the return type.`,
            severity: 'medium',
            confidence: 'high',
            recommendation: 'Return an explicit value on every path (or None everywhere).',
          }),
        );
      }
    };
    raw.forEach((line, index) => {
      const lineNo = index + 1;
      const defMatch = /^(\s*)def\s+\w+/.exec(line);
      if (defMatch) {
        checkBlock();
        blockStart = lineNo;
        blockIndent = defMatch[1]!.length;
        bareReturn = -1;
        valuedReturn = -1;
        return;
      }
      if (blockStart < 0) return;
      if (line.trim().length > 0 && pyIndentOf(line) <= blockIndent) {
        checkBlock();
        blockStart = -1;
        return;
      }
      if (/^\s*return\s*(#.*)?$/.test(line)) bareReturn = lineNo;
      else if (/^\s*return\s+\S/.test(line)) valuedReturn = lineNo;
    });
    checkBlock();

    lines.forEach((line, index) => {
      if (/\bprint\s*\(/.test(line)) {
        perFile.push(
          finding(node, {
            line: index + 1,
            category: 'style',
            ruleId: 'deep-correctness.py-print-statement',
            title: 'print() left in code',
            description: `Line ${index + 1} prints to stdout — debug residue in shipped code.`,
            severity: 'low',
            confidence: 'high',
            recommendation: 'Use the logging module or remove the print call.',
          }),
        );
      }
    });
    return perFile;
  }
}
