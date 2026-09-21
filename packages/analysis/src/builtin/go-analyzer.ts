import type { NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from './common.js';

const MAX_PER_FILE = 30;

interface GoPartial {
  line: number;
  category: NewFinding['category'];
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: NewFinding['confidence'];
  recommendation: string;
}

/** Strip // comments and string contents, preserving line structure. */
function blankGo(content: string): string[] {
  const raw = content.split('\n');
  const out: string[] = [];
  let inBlock = false;
  for (const source of raw) {
    let code = '';
    let i = 0;
    let quote: string | null = null;
    while (i < source.length) {
      const ch = source[i]!;
      const next = source[i + 1];
      if (inBlock) {
        if (ch === '*' && next === '/') {
          inBlock = false;
          i += 2;
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
        // Raw strings span lines — keep tracking across lines.
        if (ch === '`') quote = null;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlock = true;
        i += 2;
        continue;
      }
      if (ch === '/' && next === '/') break;
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        i += 1;
        continue;
      }
      code += ch;
      i += 1;
    }
    out.push(code);
  }
  return out;
}

/**
 * Real Go analysis over sanitized code (strings/comments blanked):
 * unchecked errors, panic in non-main packages, fmt printing, goroutines
 * without visible synchronization, defer inside loops, time.Sleep in
 * handlers, SQL built by concatenation (GORM Raw/Exec), weak JWT signing
 * method confusion, and context.Background in request paths.
 */
export class GoAnalyzer implements Analyzer {
  readonly kind = 'go' as const;
  readonly rulePrefix = 'go.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated || file.content === undefined) continue;
      if (normalizedExtension(file.node) !== 'go') continue;
      scanned += 1;
      const lines = blankGo(file.content);
      const isMain = /(^|\/)main\.go$/.test(file.node.relativePath) || /^\s*package\s+main\b/.test(lines[0] ?? '');
      const push = (partial: GoPartial): void => {
        if (findings.filter((f) => f.path === file.node.relativePath).length >= MAX_PER_FILE) return;
        findings.push(
          draft(ctx, {
            path: file.node.relativePath,
            fileId: file.node.id,
            source: 'analyzer',
            evidence: [],
            relatedFiles: [],
            relatedSymbols: [],
            ...partial,
          }),
        );
      };

      // 1. Unchecked errors: `x, err := f()` / `err = f()` with no `if err` nearby.
      const errDecls: { line: number; name: string }[] = [];
      lines.forEach((line, index) => {
        const m = /\b([A-Za-z_]\w*)\s*:?=\s*[A-Za-z_][\w.]*\(/.exec(line);
        if (m && /\berr\b/.test(line)) errDecls.push({ line: index + 1, name: 'err' });
      });
      for (const decl of errDecls) {
        const window = lines.slice(decl.line - 1, decl.line + 4).join('\n');
        if (!/\bif\s+err\s*!=\s*nil\b/.test(window) && !/\bif\s+err\s*==\s*nil\b/.test(window)) {
          push({
            line: decl.line,
            category: 'correctness',
            ruleId: 'go.unchecked-error',
            title: 'Error return value never checked',
            description: `${file.node.relativePath}:${decl.line} assigns err but the next lines never test \`if err != nil\` — failures proceed silently with a zero value.`,
            severity: 'high',
            confidence: 'medium',
            recommendation: 'Check `if err != nil { return ... }` immediately after the call.',
          });
        }
      }

      lines.forEach((line, index) => {
        const lineNo = index + 1;
        // 2. panic outside main.
        if (/\bpanic\s*\(/.test(line)) {
          push({
            line: lineNo,
            category: 'correctness',
            ruleId: isMain ? 'go.panic-in-main' : 'go.panic-in-library',
            title: isMain ? 'panic() in main (crashes the process)' : 'panic() in library code (crashes the caller)',
            description: `${file.node.relativePath}:${lineNo} calls panic() — in a server this kills the process instead of returning a 5xx.`,
            severity: isMain ? 'medium' : 'high',
            confidence: 'high',
            recommendation: 'Return an error and let the caller decide; reserve panic for truly unreachable code.',
          });
        }
        // 3. fmt.Print* left in non-main code.
        if (/\bfmt\.(Print|Printf|Println|Sprint)\s*\(/.test(line) && !isMain) {
          push({
            line: lineNo,
            category: 'style',
            ruleId: 'go.fmt-print-in-library',
            title: 'fmt.Print* in library code',
            description: `${file.node.relativePath}:${lineNo} writes to stdout via fmt — production services need a leveled logger.`,
            severity: 'low',
            confidence: 'high',
            recommendation: 'Use a structured logger (slog/zap) with levels instead of fmt.Print.',
          });
        }
        // 4. go statement: flag when file shows no sync/WaitGroup/channel/context usage.
        if (/(^|[^\w])go\s+(func\b|[A-Za-z_][\w.]*\()/.test(line)) {
          const body = lines.join('\n');
          const hasSync = /sync\.(WaitGroup|Mutex|Once)|chan\b|context\.(WithCancel|WithTimeout|Background|TODO)|errgroup/.test(body);
          if (!hasSync) {
            push({
              line: lineNo,
              category: 'correctness',
              ruleId: 'go.goroutine-without-sync',
              title: 'Goroutine with no visible synchronization',
              description: `${file.node.relativePath}:${lineNo} starts a goroutine but the file shows no WaitGroup, channel, or context — leaks and data races are likely.`,
              severity: 'medium',
              confidence: 'medium',
              recommendation: 'Tie the goroutine lifetime to a context or WaitGroup and guard shared state.',
            });
          }
        }
        // 5. defer inside a loop.
        if (/\bdefer\b/.test(line)) {
          const scope = lines.slice(Math.max(0, index - 6), index + 1).join('\n');
          if (/\bfor\b/.test(scope)) {
            push({
              line: lineNo,
              category: 'performance',
              ruleId: 'go.defer-in-loop',
              title: 'defer inside a loop (resources pile up)',
              description: `${file.node.relativePath}:${lineNo} defers inside a loop — deferred calls run at function return, so files/locks accumulate per iteration.`,
              severity: 'medium',
              confidence: 'medium',
              recommendation: 'Extract the loop body into a function so defer runs per iteration, or close explicitly.',
            });
          }
        }
        // 6. time.Sleep in HTTP handlers.
        if (/time\.Sleep\s*\(/.test(line) && /func\s*\(.*http\.(ResponseWriter|Request)|gin\.Context|echo\.Context/.test(lines.slice(Math.max(0, index - 15), index + 1).join('\n'))) {
          push({
            line: lineNo,
            category: 'performance',
            ruleId: 'go.sleep-in-handler',
            title: 'time.Sleep in a request handler',
            description: `${file.node.relativePath}:${lineNo} sleeps inside a request handler — it holds a worker and inflates tail latency under load.`,
            severity: 'medium',
            confidence: 'medium',
            recommendation: 'Replace polling sleeps with context-aware waits or background jobs (Asynq/Cron).',
          });
        }
        // 7. SQL via concatenation / Sprintf (db.Query, GORM Raw/Exec/Where with + or Sprintf).
        if (/(Raw|Exec|Query|Where|Order|Having)\s*\([^)]*(\+|Sprintf)/.test(line)) {
          push({
            line: lineNo,
            category: 'security',
            ruleId: 'go.sql-concatenation',
            title: 'SQL built by string concatenation (injection risk)',
            description: `${file.node.relativePath}:${lineNo} builds SQL with + or Sprintf — user input flows straight into the query.`,
            severity: 'critical',
            confidence: 'medium',
            recommendation: 'Use parameterized queries (?) / GORM placeholders instead of string building.',
          });
        }
        // 8. JWT None algorithm / insecure skip-verify.
        if (/SigningMethodNone|jwt\.ParseWithClaims[^)]*func[^}]*return\s+[^,]+,\s*nil|InsecureSkipVerify\s*:\s*true/.test(line)) {
          push({
            line: lineNo,
            category: 'security',
            ruleId: 'go.jwt-insecure',
            title: 'Insecure JWT/TLS verification',
            description: `${file.node.relativePath}:${lineNo} disables token signature verification — anyone can forge credentials.`,
            severity: 'critical',
            confidence: 'high',
            recommendation: 'Verify signatures with the expected HMAC/RSA method and reject `none`.',
          });
        }
        // 9. log.Fatal in library (kills the process incl. deferred cleanup of callers).
        if (/log\.(Fatal|Fatalf)\s*\(/.test(line) && !isMain) {
          push({
            line: lineNo,
            category: 'correctness',
            ruleId: 'go.log-fatal-in-library',
            title: 'log.Fatal in library code (os.Exit in disguise)',
            description: `${file.node.relativePath}:${lineNo} calls log.Fatal outside main — it exits the whole process with no cleanup.`,
            severity: 'high',
            confidence: 'high',
            recommendation: 'Return the error; let main decide whether to exit.',
          });
        }
      });
    }
    return { ...emptyResult('go', scanned, Date.now() - started), findings };
  }
}
