import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from './common.js';

const NODE_BUILTINS = new Set([
  'fs',
  'path',
  'os',
  'http',
  'https',
  'url',
  'util',
  'events',
  'stream',
  'crypto',
  'zlib',
  'child_process',
  'cluster',
  'dns',
  'net',
  'tls',
  'readline',
  'buffer',
  'assert',
  'tty',
  'worker_threads',
  'perf_hooks',
  'querystring',
  'string_decoder',
  'timers',
  'v8',
  'vm',
]);

const SPECIFIER_PATTERNS = [
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Package name for a specifier: '@scope/pkg/sub' -> '@scope/pkg'. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1] ?? ''}` : (parts[0] ?? specifier);
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Dependency hygiene analyzer: compares real import statements against the
 * declared manifest. Catches undeclared dependencies (a build break waiting
 * to happen), unused dependencies (dead weight), and dev-only packages that
 * leaked into runtime code.
 */
export class DependencyAnalyzer implements Analyzer {
  readonly kind = 'dependencies' as const;
  readonly rulePrefix = 'dependencies.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    const manifestFile = ctx.files.find((file) => file.node.name === 'package.json');
    if (!manifestFile) return emptyResult('dependencies', 0, Date.now() - started);
    let manifest: PackageJson = {};
    try {
      manifest = JSON.parse(manifestFile.content ?? '{}') as PackageJson;
    } catch {
      findings.push(
        draft(ctx, {
          path: manifestFile.node.relativePath,
          fileId: manifestFile.node.id,
          line: 1,
          category: 'configuration',
          ruleId: 'dependencies.invalid-manifest',
          title: 'package.json is not valid JSON',
          description: 'The manifest cannot be parsed, so dependency checks are unavailable.',
          severity: 'critical',
          confidence: 'high',
          source: 'analyzer',
          evidence: [],
          recommendation: 'Fix the JSON syntax in package.json.',
          relatedFiles: [],
          relatedSymbols: [],
        }),
      );
      return { ...emptyResult('dependencies', 1, Date.now() - started), findings };
    }

    const runtime = manifest.dependencies ?? {};
    const dev = manifest.devDependencies ?? {};
    const declared = new Set([
      ...Object.keys(runtime),
      ...Object.keys(dev),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);

    const imported = this.collectImports(ctx);
    const scanned = imported.scanned;

    for (const [name, usages] of imported.map) {
      throwIfAborted(ctx);
      if (declared.has(name)) continue;
      const first = usages[0]!;
      findings.push(
        draft(ctx, {
          path: first.path,
          fileId: first.fileId as NewFinding['fileId'],
          line: first.line,
          category: 'dependencies',
          ruleId: 'dependencies.undeclared-dependency',
          title: `Undeclared dependency: ${name}`,
          description: `${name} is imported in ${usages.length} place(s) but missing from package.json — clean installs will fail.`,
          impact: 'Build/runtime failure on a fresh checkout or CI.',
          severity: 'high',
          confidence: 'high',
          source: 'analyzer',
          evidence: [
            {
              kind: 'dependency',
              summary: `Imported at ${usages
                .slice(0, 5)
                .map((usage) => `${usage.path}:${usage.line}`)
                .join(', ')}`,
              analyzerId: 'dependencies',
              confidence: 'high',
            },
          ],
          recommendation: `Add ${name} to dependencies (npm install ${name}).`,
          relatedFiles: usages.map((usage) => usage.path),
          relatedSymbols: [name],
        }),
      );
    }
    findings.push(...this.unusedAndDevChecks(ctx, manifestFile, runtime, dev, imported.map));
    return { ...emptyResult('dependencies', scanned, Date.now() - started), findings };
  }

  private collectImports(ctx: AnalyzerContext): {
    map: Map<string, { path: string; fileId: string; line: number }[]>;
    scanned: number;
  } {
    const map = new Map<string, { path: string; fileId: string; line: number }[]>();
    let scanned = 1;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated) continue;
      if (file.node.name === 'package.json') continue;
      if (!['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(normalizedExtension(file.node)))
        continue;
      const content = file.content;
      if (content === undefined) continue;
      scanned += 1;
      for (const pattern of SPECIFIER_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          const specifier = match[1]!;
          if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
          if (specifier.startsWith('node:')) continue;
          const name = packageNameOf(specifier);
          if (NODE_BUILTINS.has(name)) continue;
          const line = content.slice(0, match.index).split('\n').length;
          const bucket = map.get(name) ?? [];
          bucket.push({ path: file.node.relativePath, fileId: file.node.id, line });
          map.set(name, bucket);
        }
      }
    }
    return { map, scanned };
  }

  private unusedAndDevChecks(
    ctx: AnalyzerContext,
    manifestFile: AnalyzerContext['files'][number],
    runtime: Record<string, string>,
    dev: Record<string, string>,
    imported: Map<string, { path: string; fileId: string; line: number }[]>,
  ): NewFinding[] {
    const findings: NewFinding[] = [];
    for (const name of Object.keys({ ...runtime, ...dev })) {
      throwIfAborted(ctx);
      if (imported.has(name)) continue;
      if (name.startsWith('@types/') || ['typescript', 'eslint'].includes(name)) continue;
      findings.push(
        draft(ctx, {
          path: manifestFile.node.relativePath,
          fileId: manifestFile.node.id,
          line: 1,
          category: 'dependencies',
          ruleId: 'dependencies.unused-dependency',
          title: `Unused dependency: ${name}`,
          description: `${name} is declared in package.json but never imported by the indexed code.`,
          impact: 'Larger installs and a wider supply-chain surface than needed.',
          severity: 'medium',
          confidence: 'medium',
          source: 'analyzer',
          evidence: [],
          recommendation: `Remove ${name} from package.json if no tooling needs it.`,
          relatedFiles: [],
          relatedSymbols: [name],
        }),
      );
    }

    for (const [name, usages] of imported) {
      if (!(name in dev)) continue;
      for (const usage of usages) {
        if (!/^(src|app|lib|server)\//i.test(usage.path)) continue;
        findings.push(
          draft(ctx, {
            path: usage.path,
            fileId: usage.fileId as NewFinding['fileId'],
            line: usage.line,
            category: 'dependencies',
            ruleId: 'dependencies.dev-dependency-in-runtime',
            title: `Dev-only package used at runtime: ${name}`,
            description: `${name} is a devDependency but imported by ${usage.path} — production installs will not have it.`,
            severity: 'high',
            confidence: 'medium',
            source: 'analyzer',
            evidence: [],
            recommendation: `Move ${name} to dependencies or replace it with a runtime-safe alternative.`,
            relatedFiles: [],
            relatedSymbols: [name],
          }),
        );
      }
    }
    return findings;
  }
}
