import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, throwIfAborted } from './common.js';

const IMPORT_PATTERNS = [
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*from\s+(\S+)\s+import\s+/gm,
  /^\s*import\s+(\S+)/gm,
];

const INDEX_CANDIDATES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.py',
  '__init__.py',
];
const EXT_CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.json'];

/**
 * Import integrity analyzer. Resolves relative imports against the indexed
 * file set and reports broken references — the cheapest high-value signal
 * for missing integrations and refactor damage.
 */
export class ImportAnalyzer implements Analyzer {
  readonly kind = 'imports' as const;
  readonly rulePrefix = 'imports.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    const known = new Set(ctx.files.map((file) => file.node.relativePath));
    let scanned = 0;

    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated) continue;
      const content = file.content;
      if (content === undefined) continue;
      if (!isCodeLanguage(file.node.language)) continue;
      scanned += 1;
      const specifiers = collectSpecifiers(content);
      for (const { specifier, line } of specifiers) {
        if (!specifier.startsWith('.')) continue;
        const candidates = resolveCandidates(file.node.relativePath, specifier);
        if (candidates === undefined || candidates.some((c) => known.has(c))) continue;
        findings.push(
          draft(ctx, {
            path: file.node.relativePath,
            fileId: file.node.id,
            line,
            category: 'dependencies',
            ruleId: 'imports.broken-relative-import',
            title: `Broken import: ${specifier}`,
            description: `Line ${line} imports '${specifier}', which does not resolve to any indexed file. The module may be missing, moved, or excluded by ignore rules.`,
            impact: 'Runtime import failure or bundler error.',
            severity: 'high',
            confidence: 'high',
            source: 'analyzer',
            evidence: [
              {
                kind: 'dependency',
                summary: `Specifier '${specifier}' from ${file.node.relativePath} has no target in the index.`,
                analyzerId: 'imports',
                confidence: 'high',
              },
            ],
            recommendation: `Verify the target exists or fix the specifier. Searched: ${(candidates ?? []).join(', ')}.`,
            relatedFiles: [],
            relatedSymbols: [],
          }),
        );
      }
    }
    return { ...emptyResult('imports', scanned, Date.now() - started), findings };
  }
}

function isCodeLanguage(language: string): boolean {
  return ['typescript', 'javascript', 'python'].includes(language);
}

function collectSpecifiers(content: string): { specifier: string; line: number }[] {
  const out: { specifier: string; line: number }[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[1];
      if (!specifier) continue;
      const line = content.slice(0, match.index).split('\n').length;
      out.push({ specifier, line });
    }
  }
  return out;
}

/**
 * Candidate targets for a relative specifier: exact path, known extensions,
 * and directory index files. The caller checks them against the file index.
 * Returns undefined when the specifier escapes the project root.
 */
function resolveCandidates(fromFile: string, specifier: string): string[] | undefined {
  const dirParts = fromFile.split('/').slice(0, -1);
  const parts: string[] = [...dirParts];
  for (const segment of specifier.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  const base = parts.join('/');
  const candidates: string[] = [base];
  const hasKnownExtension = EXT_CANDIDATES.some((ext) => ext !== '' && base.endsWith(ext));
  if (!hasKnownExtension) {
    for (const ext of EXT_CANDIDATES) {
      if (ext === '') continue;
      candidates.push(`${base}${ext}`);
    }
    for (const index of INDEX_CANDIDATES) {
      candidates.push(`${base}/${index}`);
    }
  }
  return candidates;
}
