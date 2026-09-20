import type { NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, textLines, throwIfAborted } from './common.js';

interface SecurityRule {
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  pattern: RegExp;
  recommendation: string;
}

const RULES: SecurityRule[] = [
  {
    ruleId: 'security-heuristics.hardcoded-secret',
    title: 'Possible hardcoded secret',
    description: 'An assignment looks like an embedded password, token, or API key.',
    severity: 'critical',
    pattern: /\b(password|passwd|secret|api[_-]?key|auth[_-]?token)\b\s*[:=]\s*['"][^'"]{4,}['"]/i,
    recommendation: 'Move the secret to an environment variable or secret store; rotate it.',
  },
  {
    ruleId: 'security-heuristics.private-key',
    title: 'Private key material in source',
    description: 'PEM-encoded private key material is checked into the project.',
    severity: 'critical',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    recommendation: 'Remove the key immediately, rotate it, and use a secret store.',
  },
  {
    ruleId: 'security-heuristics.eval-use',
    title: 'Dynamic code evaluation (eval)',
    description: 'eval() executes strings as code and enables injection attacks.',
    severity: 'high',
    pattern: /\beval\s*\(/,
    recommendation: 'Replace eval with structured parsing (e.g. JSON.parse) or a sandbox.',
  },
  {
    ruleId: 'security-heuristics.dangerous-html',
    title: 'Unsanitized HTML injection',
    description: 'innerHTML or dangerouslySetInnerHTML sinks enable XSS when fed untrusted data.',
    severity: 'high',
    pattern: /(\.innerHTML\s*=|dangerouslySetInnerHTML)/,
    recommendation: 'Sanitize untrusted HTML or render text instead of markup.',
  },
  {
    ruleId: 'security-heuristics.weak-hash',
    title: 'Weak cryptographic hash',
    description: 'MD5/SHA-1 are broken for integrity and password purposes.',
    severity: 'medium',
    pattern: /\b(md5|sha1)\s*\(/i,
    recommendation: 'Use SHA-256 or better; bcrypt/argon2 for passwords.',
  },
  {
    ruleId: 'security-heuristics.insecure-url',
    title: 'Plaintext HTTP URL',
    description: 'Credentials or data sent over http:// can be intercepted.',
    severity: 'low',
    pattern: /['"]http:\/\/[^'"]+['"]/,
    recommendation: 'Prefer https:// endpoints.',
  },
];

const MAX_FINDINGS_PER_FILE = 10;

/**
 * Security heuristics (triage, not a scanner). Deterministic patterns catch
 * high-signal issues; every hit ships with MEDIUM confidence at most, so the
 * report distinguishes them from verified scanner output in later phases.
 */
export class SecurityHeuristicsAnalyzer implements Analyzer {
  readonly kind = 'security-heuristics' as const;
  readonly rulePrefix = 'security-heuristics.';
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
      lines.forEach((line, index) => {
        if (perFile >= MAX_FINDINGS_PER_FILE) return;
        for (const rule of RULES) {
          if (!rule.pattern.test(line)) continue;
          perFile += 1;
          findings.push(
            draft(ctx, {
              path: file.node.relativePath,
              fileId: file.node.id,
              line: index + 1,
              category: 'security',
              ruleId: rule.ruleId,
              title: rule.title,
              description: `${rule.description} (${file.node.relativePath}:${index + 1})`,
              severity: rule.severity,
              confidence: 'medium',
              source: 'analyzer',
              evidence: [
                {
                  kind: 'code-excerpt',
                  summary: line.trim().slice(0, 200),
                  ref: `${file.node.relativePath}:${index + 1}`,
                  analyzerId: 'security-heuristics',
                  confidence: 'medium',
                },
              ],
              recommendation: rule.recommendation,
              relatedFiles: [],
              relatedSymbols: [],
            }),
          );
          break;
        }
      });
    }
    return { ...emptyResult('security-heuristics', scanned, Date.now() - started), findings };
  }
}
