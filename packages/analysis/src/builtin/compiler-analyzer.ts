import type { NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from '../builtin/common.js';

const MAX_PER_FILE = 40;

/** Compiler options for the on-demand real (compiler-grade) analysis pass. */
const BASE_OPTIONS = {
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noImplicitAny: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noUncheckedIndexedAccess: true,
  allowJs: true,
  checkJs: false,
  skipLibCheck: true,
  noEmit: true,
  allowNonTsExtensions: true,
  resolveJsonModule: true,
} as const;

function compilerOptions(ts: typeof import('typescript')): import('typescript').CompilerOptions {
  return {
    ...BASE_OPTIONS,
    types: [] as string[],
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
  };
}

const BUILD_BREAKERS = new Set([
  2304, 2307, 2322, 2339, 2345, 2551, 2554, 2588, 2739, 2741, 18048, 2532, 2531, 2362, 2365, 2451,
  2454, 7006, 7005, 7031, 7027, 1005, 1109, 1128, 1434, 1472,
]);

function severityFor(code: number): Severity {
  if (code >= 1000 && code < 2000) return 'critical'; // syntax: file does not parse
  if (BUILD_BREAKERS.has(code)) return 'high';
  return 'medium';
}

function recommendationFor(code: number): string {
  switch (code) {
    case 2304:
      return 'Import or declare the name before use.';
    case 2307:
      return 'Fix the import path, or install the missing module.';
    case 2322:
    case 2345:
    case 2739:
    case 2741:
      return 'Align the value with the declared type (or fix the type if the value is right).';
    case 2339:
    case 2551:
      return 'Check the property name and the type it is accessed on.';
    case 2554:
      return 'Pass the exact number of arguments the signature requires.';
    case 7006:
    case 7005:
    case 7031:
      return 'Add an explicit type annotation instead of relying on any.';
    case 18048:
    case 2532:
    case 2531:
      return 'Guard with an explicit check (if / ??) before using the value.';
    case 6133:
    case 6196:
    case 6198:
      return 'Remove the unused declaration or start using it.';
    case 2454:
      return 'Assign the variable before this point in every code path.';
    case 2451:
      return 'Rename or remove the duplicate declaration.';
    case 7027:
      return 'Remove or reorder the unreachable code.';
    default:
      if (code >= 1000 && code < 2000) return 'Fix the syntax error reported at this position.';
      return 'Resolve the compiler diagnostic at this location.';
  }
}

/**
 * Real compiler-backed analysis: builds an in-memory TypeScript program from
 * the project's own files and reports the compiler's diagnostics with exact
 * file, line and column — syntax errors, type errors, unresolved imports,
 * unused locals/parameters, implicit any, and unreachable code.
 *
 * `typescript` is imported lazily so the heavy compiler chunk is only fetched
 * when a compiler-grade pass actually runs.
 */
export class CompilerAnalyzer implements Analyzer {
  readonly kind = 'compiler' as const;
  readonly rulePrefix = 'compiler.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const files = ctx.files.filter(
      (file) =>
        !file.node.binary &&
        !file.node.generated &&
        file.content !== undefined &&
        ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(normalizedExtension(file.node)),
    );
    if (files.length === 0) return emptyResult('compiler', 0, Date.now() - started);

    const ts = (await import('typescript')).default;
    const sources = new Map<string, string>();
    for (const file of files) {
      sources.set(`/${file.node.relativePath.replace(/^\/+/, '')}`, file.content as string);
    }

    const options = compilerOptions(ts);
    const host = ts.createCompilerHost(options, true);

    /** Resolve any resolver-computed path to the in-memory project path. */
    const normalize = (name: string): string | undefined => {
      const clean = name.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
      if (sources.has(clean)) return clean;
      const withSlash = clean.startsWith('/') ? clean : `/${clean}`;
      if (sources.has(withSlash)) return withSlash;
      const withoutSlash = clean.replace(/^\/+/, '');
      if (sources.has(`/${withoutSlash}`)) return `/${withoutSlash}`;
      // Suffix match: resolver paths like /src/format.ts vs ./format lookups.
      for (const key of sources.keys()) {
        if (key.endsWith(clean) || clean.endsWith(key) || key.endsWith(withoutSlash)) return key;
      }
      return undefined;
    };
    // Bypass the resolver entirely for in-memory paths: map each import
    // specifier to its in-memory target (or undefined for external modules).
    function resolveInMemory(specifier: string, containingFile: string): string | undefined {
      if (!specifier.startsWith('.')) return undefined;
      const dir = containingFile.slice(0, containingFile.lastIndexOf('/'));
      const parts = specifier.split('/');
      const stack = dir.split('/');
      for (const part of parts) {
        if (part === '.' || part === '') continue;
        if (part === '..') stack.pop();
        else stack.push(part);
      }
      const base = stack.join('/');
      const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.d.ts'];
      for (const ext of extensions) {
        if (sources.has(`${base}${ext}`)) return `${base}${ext}`;
      }
      for (const indexFile of ['index.ts', 'index.tsx', 'index.js']) {
        if (sources.has(`${base}/${indexFile}`)) return `${base}/${indexFile}`;
      }
      return undefined;
    }

    host.resolveModuleNames = (moduleNames, containingFile) => {
      return moduleNames.map((moduleName) => {
        const resolved = resolveInMemory(moduleName, containingFile);
        if (resolved !== undefined) return { resolvedFileName: resolved };
        return undefined; // Let TS handle external modules
      });
    };
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      const key = normalize(fileName);
      if (process.env['TAHLELY_TSC_DEBUG'] === '1') {
         
        console.log('DBG tsc getSourceFile:', JSON.stringify(fileName), '->', JSON.stringify(key));
      }
      if (key !== undefined) {
        return ts.createSourceFile(fileName, sources.get(key) as string, languageVersion, true);
      }
      return originalGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    };
    host.fileExists = (fileName) => {
      const hit = normalize(fileName) !== undefined || ts.sys.fileExists(fileName);
      if (process.env['TAHLELY_TSC_DEBUG'] === '1' && !hit) {
         
        console.log('DBG tsc fileExists MISS:', JSON.stringify(fileName));
      }
      return hit;
    };
    host.readFile = (fileName) => {
      const key = normalize(fileName);
      if (key !== undefined) return sources.get(key);
      return ts.sys.readFile(fileName);
    };
    host.getCurrentDirectory = () => '/';
    host.getCanonicalFileName = (fileName) => normalize(fileName) ?? fileName;

    const program = ts.createProgram([...sources.keys()], options, host);
    throwIfAborted(ctx);

    const findings: NewFinding[] = [];
    const perFile = new Map<string, number>();
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      const code = diagnostic.code;
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
      const fileName = diagnostic.file?.fileName;
      if (!fileName) continue;
      const normalized = normalize(fileName);
      if (normalized === undefined) continue;
      const relativePath = normalized.replace(/^\/+/, '');
      const count = perFile.get(relativePath) ?? 0;
      if (count >= MAX_PER_FILE) continue;
      perFile.set(relativePath, count + 1);
      let line: number | undefined;
      let column: number | undefined;
      if (diagnostic.file && diagnostic.start !== undefined) {
        const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        line = position.line + 1;
        column = position.character + 1;
      }
      findings.push(
        draft(ctx, {
          path: relativePath,
          line,
          column,
          category: 'correctness',
          ruleId: `compiler.TS${code}`,
          title: message.slice(0, 120),
          description: `TypeScript compiler diagnostic TS${code} at ${relativePath}${line ? `:${line}:${column ?? 1}` : ''} — ${message}`,
          impact:
            code >= 1000 && code < 2000
              ? 'The file does not parse; nothing in it can run.'
              : 'A real type error reported by the TypeScript compiler.',
          severity: severityFor(code),
          confidence: 'high',
          source: 'compiler',
          evidence: [
            {
              kind: 'compiler',
              summary: `TS${code}: ${message}`.slice(0, 240),
              ref: `${relativePath}${line ? `:${line}` : ''}`,
              analyzerId: 'compiler',
              confidence: 'high',
            },
          ],
          recommendation: recommendationFor(code),
          relatedFiles: [],
          relatedSymbols: [],
        }),
      );
    }
    return { ...emptyResult('compiler', files.length, Date.now() - started), findings };
  }
}
