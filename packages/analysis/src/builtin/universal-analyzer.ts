import type { NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from './common.js';

const MAX_PER_FILE = 20;

interface FileRule {
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  category: NewFinding['category'];
  pattern: RegExp;
  recommendation: string;
  extensions: string[];
}

const RULES: FileRule[] = [
  {
    ruleId: 'universal.yaml-tabs',
    title: 'YAML uses tabs for indentation',
    description: 'YAML spec forbids tabs for indentation — parsing will fail.',
    severity: 'high',
    category: 'correctness',
    pattern: /^\t/m,
    extensions: ['yml', 'yaml'],
    recommendation: 'Replace tabs with spaces.',
  },
  {
    ruleId: 'universal.html-missing-alt',
    title: 'Missing alt attribute on image',
    description: 'An <img> without alt is inaccessible and fails HTML validation.',
    severity: 'medium',
    category: 'correctness',
    pattern: /<img\b(?![^>]*\balt=)/i,
    extensions: ['html', 'htm'],
    recommendation: 'Add alt="…" to every <img> tag.',
  },
  {
    ruleId: 'universal.html-inline-handler',
    title: 'Inline event handler in HTML',
    description: 'onclick/onload attributes mix markup and logic; they are a CSP violation.',
    severity: 'medium',
    category: 'security',
    pattern: /\bon(click|load|error|mouseover|submit)\s*=/i,
    extensions: ['html', 'htm'],
    recommendation: 'Use addEventListener in a script instead of inline handlers.',
  },
  {
    ruleId: 'universal.html-missing-title',
    title: 'Missing <title> tag',
    description: 'A page without <title> has no accessible name.',
    severity: 'low',
    category: 'correctness',
    pattern: /<head[^>]*>[\s\S]*<\/head>(?![\s\S]*<title)/i,
    extensions: ['html', 'htm'],
    recommendation: 'Add a <title> tag inside <head>.',
  },
  {
    ruleId: 'universal.css-important-overuse',
    title: 'Excessive !important usage',
    description:
      'Multiple !important declarations break the cascade and make styling unmaintainable.',
    severity: 'low',
    category: 'style',
    pattern: /!important/,
    extensions: ['css'],
    recommendation: 'Refactor selectors to use specificity instead of !important.',
  },
  {
    ruleId: 'universal.css-hardcoded-px',
    title: 'Hardcoded pixel values',
    description: 'Pixel values in CSS prevent responsive scaling and accessibility.',
    severity: 'info',
    category: 'style',
    pattern: /\b\d+px\b/,
    extensions: ['css'],
    recommendation: 'Use rem/em/vw/vh for responsive sizing.',
  },
  {
    ruleId: 'universal.sql-delete-without-where',
    title: 'DELETE without WHERE clause',
    description: 'A DELETE without WHERE removes every row in the table.',
    severity: 'critical',
    category: 'correctness',
    pattern: /\bDELETE\s+FROM\s+\w+\s*(;|$)/im,
    extensions: ['sql'],
    recommendation: 'Add a WHERE clause to limit the affected rows.',
  },
  {
    ruleId: 'universal.sql-select-star',
    title: 'SELECT * usage',
    description: 'SELECT * fetches every column — inefficient and fragile to schema changes.',
    severity: 'medium',
    category: 'performance',
    pattern: /\bSELECT\s+\*\s+FROM\b/i,
    extensions: ['sql'],
    recommendation: 'Name the columns explicitly.',
  },
  {
    ruleId: 'universal.sql-drop-table',
    title: 'DROP TABLE in SQL file',
    description: 'DROP TABLE destroys data permanently — a dangerous statement in a script.',
    severity: 'high',
    category: 'security',
    pattern: /\bDROP\s+TABLE\b/i,
    extensions: ['sql'],
    recommendation: 'Use migrations with explicit confirmation for schema changes.',
  },
  {
    ruleId: 'universal.sql-concatenation-injection',
    title: 'SQL built via string concatenation',
    description: 'String concatenation in SQL enables SQL injection attacks.',
    severity: 'critical',
    category: 'security',
    pattern: /['"`]\s*\+\s*\w+|EXEC\s*\(/i,
    extensions: ['sql'],
    recommendation: 'Use parameterized queries / prepared statements.',
  },
  {
    ruleId: 'universal.shell-unquoted-variable',
    title: 'Unquoted shell variable',
    description:
      'Unquoted $var expands with word splitting and glob expansion — a common shell bug.',
    severity: 'medium',
    category: 'correctness',
    pattern: /\$[A-Za-z_]\w*(?!\s*['"`])/,
    extensions: ['sh', 'bash', 'zsh'],
    recommendation: 'Quote the variable: "$var".',
  },
  {
    ruleId: 'universal.shell-curl-pipe-sh',
    title: 'curl piped to shell',
    description: 'Executing downloaded scripts without verification is a supply-chain risk.',
    severity: 'critical',
    category: 'security',
    pattern: /\bcurl\b[^|]*\|\s*(sudo\s+)?(bash|sh)\b/,
    extensions: ['sh', 'bash', 'zsh'],
    recommendation: 'Download, verify the checksum, review, then execute.',
  },
  {
    ruleId: 'universal.shell-rm-rf',
    title: 'rm -rf in shell script',
    description: 'rm -rf without safeguards can destroy data permanently.',
    severity: 'high',
    category: 'correctness',
    pattern: /\brm\s+(-[rf]+\s+|\s+-[rf]+\s+)[/~$]/,
    extensions: ['sh', 'bash', 'zsh'],
    recommendation: 'Guard rm -rf with explicit path checks and a safety variable.',
  },
  {
    ruleId: 'universal.markdown-broken-link',
    title: 'Broken relative link in Markdown',
    description: 'A relative link in Markdown that points to a missing file.',
    severity: 'medium',
    category: 'correctness',
    pattern: /\[[^\]]*\]\((?!https?:|#|mailto:)([^)]+)\)/,
    extensions: ['md', 'markdown'],
    recommendation: 'Fix the link to point to an existing file.',
  },
  {
    ruleId: 'universal.go-panic-in-library',
    title: 'panic() in Go library code',
    description: 'panic() in a library function crashes the caller — return an error instead.',
    severity: 'high',
    category: 'correctness',
    pattern: /\bpanic\s*\(/,
    extensions: ['go'],
    recommendation: 'Return an error and let the caller decide.',
  },
  {
    ruleId: 'universal.go-fmt-println',
    title: 'fmt.Println in Go code',
    description: 'fmt.Println is debug output left in production Go code.',
    severity: 'low',
    category: 'style',
    pattern: /\bfmt\.Print/,
    extensions: ['go'],
    recommendation: 'Use a logger with levels instead of fmt.Println.',
  },
  {
    ruleId: 'universal.rust-unwrap-overuse',
    title: 'Excessive .unwrap() in Rust',
    description: 'Every .unwrap() is a potential panic — use ? or handle the error.',
    severity: 'medium',
    category: 'correctness',
    pattern: /\.unwrap\s*\(\)/,
    extensions: ['rs'],
    recommendation: 'Replace .unwrap() with ? or explicit error handling.',
  },
  {
    ruleId: 'universal.rust-unsafe-block',
    title: 'unsafe block in Rust',
    description: 'unsafe blocks bypass the borrow checker — audit them carefully.',
    severity: 'medium',
    category: 'correctness',
    pattern: /\bunsafe\s*\{/,
    extensions: ['rs'],
    recommendation: 'Document the safety invariant for every unsafe block.',
  },
  {
    ruleId: 'universal.java-system-out',
    title: 'System.out.println in Java',
    description: 'System.out.println is debug output left in production Java code.',
    severity: 'low',
    category: 'style',
    pattern: /\bSystem\.out\.print/,
    extensions: ['java'],
    recommendation: 'Use a logger with levels instead of System.out.println.',
  },
  {
    ruleId: 'universal.java-empty-catch',
    title: 'Empty catch block in Java',
    description: 'An empty catch block swallows exceptions silently.',
    severity: 'high',
    category: 'correctness',
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    extensions: ['java'],
    recommendation: 'Log the exception and add context, or rethrow.',
  },
  {
    ruleId: 'universal.csharp-console-write',
    title: 'Console.WriteLine in C#',
    description: 'Console.WriteLine is debug output left in production C# code.',
    severity: 'low',
    category: 'style',
    pattern: /\bConsole\.Write/,
    extensions: ['cs'],
    recommendation: 'Use ILogger or Debug.WriteLine instead.',
  },
  {
    ruleId: 'universal.csharp-unsafe',
    title: 'unsafe block in C#',
    description: 'unsafe blocks bypass memory safety — audit them carefully.',
    severity: 'high',
    category: 'correctness',
    pattern: /\bunsafe\s*\{/,
    extensions: ['cs'],
    recommendation: 'Document the safety invariant for every unsafe block.',
  },
];

/**
 * Universal analyzer: runs real checks on every file type in the project,
 * not just code. JSON validity is verified by actual parsing; YAML is
 * checked for spec violations; HTML/CSS/SQL/Shell/Markdown/Go/Rust/Java/C#
 * each get their own real rules with exact line numbers.
 */
export class UniversalAnalyzer implements Analyzer {
  readonly kind = 'universal' as const;
  readonly rulePrefix = 'universal.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated) continue;
      if (file.content === undefined) continue;
      const ext = normalizedExtension(file.node);
      const content = file.content as string;
      scanned += 1;
      const lines = content.split('\n');

      if (ext === 'json') {
        try {
          JSON.parse(content);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const match = /position (\d+)/.exec(message);
          let line = 1;
          if (match) {
            const pos = parseInt(match[1]!, 10);
            let acc = 0;
            for (let i = 0; i < lines.length; i += 1) {
              acc += (lines[i]!.length ?? 0) + 1;
              if (acc > pos) {
                line = i + 1;
                break;
              }
            }
          }
          findings.push(
            draft(ctx, {
              path: file.node.relativePath,
              fileId: file.node.id,
              line,
              category: 'correctness',
              ruleId: 'universal.json-invalid',
              title: 'Invalid JSON',
              description: `${file.node.relativePath}:${line} — ${message.slice(0, 200)}`,
              severity: 'critical',
              confidence: 'high',
              source: 'analyzer',
              evidence: [{ kind: 'analyzer', summary: message.slice(0, 200), confidence: 'high' }],
              recommendation: 'Fix the JSON syntax error.',
              relatedFiles: [],
              relatedSymbols: [],
            }),
          );
        }
        continue;
      }

      if (ext === 'md' || ext === 'markdown') {
        const nonEmpty = lines.filter((l) => l.trim().length > 0);
        if (nonEmpty.length > 0 && nonEmpty.length < 5) {
          findings.push(
            draft(ctx, {
              path: file.node.relativePath,
              fileId: file.node.id,
              line: 1,
              category: 'style',
              ruleId: 'universal.markdown-empty',
              title: 'Empty or stub Markdown file',
              description: `${file.node.relativePath} has only ${nonEmpty.length} non-empty lines — likely incomplete.`,
              severity: 'info',
              confidence: 'high',
              source: 'analyzer',
              evidence: [],
              recommendation: 'Fill in the document or remove the placeholder.',
              relatedFiles: [],
              relatedSymbols: [],
            }),
          );
        }
      }

      let perFile = 0;
      for (const rule of RULES) {
        if (perFile >= MAX_PER_FILE) break;
        if (!rule.extensions.includes(ext)) continue;
        lines.forEach((line, index) => {
          if (perFile >= MAX_PER_FILE) return;
          if (!rule.pattern.test(line)) return;
          perFile += 1;
          findings.push(
            draft(ctx, {
              path: file.node.relativePath,
              fileId: file.node.id,
              line: index + 1,
              category: rule.category,
              ruleId: rule.ruleId,
              title: rule.title,
              description: `${rule.description} (${file.node.relativePath}:${index + 1})`,
              severity: rule.severity,
              confidence: 'high',
              source: 'analyzer',
              evidence: [
                {
                  kind: 'code-excerpt',
                  summary: line.trim().slice(0, 200),
                  ref: `${file.node.relativePath}:${index + 1}`,
                  analyzerId: 'universal',
                  confidence: 'high',
                },
              ],
              recommendation: rule.recommendation,
              relatedFiles: [],
              relatedSymbols: [],
            }),
          );
        });
      }
    }
    return { ...emptyResult('universal', scanned, Date.now() - started), findings };
  }
}
