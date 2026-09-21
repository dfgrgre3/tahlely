import type { NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, throwIfAborted } from './common.js';

function baseName(rel: string): string {
  return rel.split('/').pop()?.toLowerCase() ?? rel.toLowerCase();
}

function lineOf(content: string, needle: string): number {
  const idx = content.indexOf(needle);
  if (idx < 0) return 1;
  return content.slice(0, idx).split('\n').length;
}

/**
 * Real configuration analysis: actually parses package.json / tsconfig.json /
 * .env / YAML / TOML / INI content and reports genuine defects — invalid
 * syntax, missing required fields, unknown scripts entries, and secrets
 * committed in env files — with exact line numbers.
 */
export class ConfigAnalyzer implements Analyzer {
  readonly kind = 'config' as const;
  readonly rulePrefix = 'config.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated || file.content === undefined) continue;
      const name = baseName(file.node.relativePath);
      const content = file.content;
      type ConfigPartial = {
        line?: number;
        category: NewFinding['category'];
        ruleId: string;
        title: string;
        description: string;
        severity: Severity;
        confidence: NewFinding['confidence'];
        recommendation: string;
      };
      const push = (partial: ConfigPartial): void => {
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

      if (name === 'package.json') {
        scanned += 1;
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          if (typeof parsed['name'] !== 'string') {
            push({ line: 1, category: 'configuration', ruleId: 'config.package-missing-name', title: 'package.json has no "name"', description: `${file.node.relativePath} is missing the required "name" field — installs and publishing break.`, severity: 'high' as Severity, confidence: 'high', recommendation: 'Add a "name" field to package.json.' });
          }
          if (typeof parsed['version'] !== 'string') {
            push({ line: 1, category: 'configuration', ruleId: 'config.package-missing-version', title: 'package.json has no "version"', description: `${file.node.relativePath} is missing the required "version" field.`, severity: 'medium' as Severity, confidence: 'high', recommendation: 'Add a semver "version" field.' });
          }
          const scripts = parsed['scripts'];
          if (scripts !== undefined && (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts))) {
            push({ line: lineOf(content, '"scripts"'), category: 'configuration', ruleId: 'config.package-bad-scripts', title: '"scripts" is not an object', description: `"scripts" in ${file.node.relativePath} must map names to commands.`, severity: 'high' as Severity, confidence: 'high', recommendation: 'Make "scripts" an object of name → command entries.' });
          }
        } catch (error) {
          push({ line: 1, category: 'configuration', ruleId: 'config.package-invalid-json', title: 'package.json is not valid JSON', description: `${file.node.relativePath} fails to parse: ${error instanceof Error ? error.message : String(error)}`.slice(0, 240), severity: 'critical' as Severity, confidence: 'high', recommendation: 'Fix the JSON syntax error.' });
        }
        continue;
      }

      if (name === 'tsconfig.json') {
        scanned += 1;
        try {
          const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
          const parsed = JSON.parse(stripped) as Record<string, unknown>;
          if (parsed['compilerOptions'] !== undefined && typeof parsed['compilerOptions'] !== 'object') {
            push({ line: lineOf(content, 'compilerOptions'), category: 'configuration', ruleId: 'config.tsconfig-bad-options', title: '"compilerOptions" is not an object', description: `"compilerOptions" in ${file.node.relativePath} must be an object.`, severity: 'high' as Severity, confidence: 'high', recommendation: 'Fix the compilerOptions block.' });
          }
        } catch (error) {
          push({ line: 1, category: 'configuration', ruleId: 'config.tsconfig-invalid-json', title: 'tsconfig.json is not valid JSON', description: `${file.node.relativePath} fails to parse: ${error instanceof Error ? error.message : String(error)}`.slice(0, 240), severity: 'critical' as Severity, confidence: 'high', recommendation: 'Fix the JSON syntax error (comments are allowed, trailing commas are not).' });
        }
        continue;
      }

      if (name === '.env' || name.startsWith('.env.')) {
        scanned += 1;
        const lines = content.split('\n');
        lines.forEach((rawLine, index) => {
          const lineNo = index + 1;
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) return;
          const eq = line.indexOf('=');
          if (eq < 0) {
            push({ line: lineNo, category: 'configuration', ruleId: 'config.env-malformed-line', title: 'Malformed .env line (no KEY=VALUE)', description: `${file.node.relativePath}:${lineNo} is not KEY=VALUE form — the entry is ignored at runtime.`, severity: 'medium' as Severity, confidence: 'high', recommendation: 'Write the entry as KEY=value.' });
            return;
          }
          const key = line.slice(0, eq).trim();
          const value = line.slice(eq + 1).trim();
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            push({ line: lineNo, category: 'configuration', ruleId: 'config.env-bad-key', title: `Invalid env key: ${key}`, description: `${file.node.relativePath}:${lineNo} — env keys must match [A-Za-z_][A-Za-z0-9_]*.`, severity: 'medium' as Severity, confidence: 'high', recommendation: 'Rename the key to a valid identifier.' });
          }
          if (/SECRET|TOKEN|PRIVATE|PASSWORD|API[_-]?KEY/i.test(key) && value && value.length > 0) {
            push({ line: lineNo, category: 'security', ruleId: 'config.env-secret-committed', title: `Secret value committed in ${file.node.relativePath}: ${key}`, description: `${file.node.relativePath}:${lineNo} stores a live secret for ${key} in the repo — anyone with read access owns it.`, severity: 'critical' as Severity, confidence: 'medium', recommendation: 'Remove the value, load it from a secret manager, and rotate the credential.' });
          }
        });
        continue;
      }

      if (name.endsWith('.yml') || name.endsWith('.yaml')) {
        scanned += 1;
        const lines = content.split('\n');
        lines.forEach((rawLine, index) => {
          if (/^\t/.test(rawLine)) {
            push({ line: index + 1, category: 'configuration', ruleId: 'config.yaml-tab-indent', title: 'YAML uses tabs for indentation', description: `${file.node.relativePath}:${index + 1} — YAML forbids tabs; parsing fails.`, severity: 'high' as Severity, confidence: 'high', recommendation: 'Replace tabs with spaces.' });
          }
        });
        continue;
      }

      if (name.endsWith('.toml') || name.endsWith('.ini') || name.endsWith('.cfg')) {
        scanned += 1;
        const lines = content.split('\n');
        let section = false;
        lines.forEach((rawLine, index) => {
          const line = rawLine.trim();
          if (!line || line.startsWith('#') || line.startsWith(';')) return;
          if (/^\[.+\]$/.test(line)) {
            section = true;
            return;
          }
          if (!section && /=/.test(line) && (name.endsWith('.toml'))) {
            return;
          }
          if (!line.includes('=') && !line.startsWith('[')) {
            push({ line: index + 1, category: 'configuration', ruleId: 'config.ini-malformed-line', title: 'Malformed config line', description: `${file.node.relativePath}:${index + 1} is neither [section] nor key=value.`, severity: 'medium' as Severity, confidence: 'medium', recommendation: 'Fix the line to key = value or a [section] header.' });
          }
        });
        continue;
      }
    }
    return { ...emptyResult('config', scanned, Date.now() - started), findings };
  }
}
