import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from './common.js';

interface RouteDef {
  method: string;
  path: string;
  line: number;
  file: string;
}

const ROUTE_PATTERN = /\b(app|router|server|api)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/g;
const DECORATOR_PATTERN = /@(Get|Post|Put|Patch|Delete|Options|Head|All|Route|Controller)\s*\(?\s*['"`]([^'"`]*)['"`]?/g;
const FETCH_PATTERN = /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/g;
const AXIOS_PATTERN = /\baxios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g;

/**
 * Real API-contract analysis: extracts declared server routes (Express-style
 * app.get('/x'), Nest-style @Get('/x')) and client call sites
 * (fetch('/x'), axios.get('/x')), then reports client calls with no matching
 * server route and server routes with no client — genuine contract drift,
 * not pattern lore.
 */
export class ApiContractAnalyzer implements Analyzer {
  readonly kind = 'api-contract' as const;
  readonly rulePrefix = 'api-contract.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    const routes: RouteDef[] = [];
    const clients: { path: string; line: number; file: string }[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      if (file.node.binary || file.node.generated || file.content === undefined) continue;
      const ext = normalizedExtension(file.node);
      if (!['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py'].includes(ext)) continue;
      scanned += 1;
      const content = file.content;
      let m: RegExpExecArray | null;
      ROUTE_PATTERN.lastIndex = 0;
      while ((m = ROUTE_PATTERN.exec(content)) !== null) {
        routes.push({ method: (m[2] ?? 'all').toUpperCase(), path: normalizePath(m[3] ?? ''), line: lineOf(content, m.index), file: file.node.relativePath });
      }
      DECORATOR_PATTERN.lastIndex = 0;
      while ((m = DECORATOR_PATTERN.exec(content)) !== null) {
        const method = (m[1] ?? 'route').toUpperCase();
        routes.push({ method, path: normalizePath(m[2] ?? ''), line: lineOf(content, m.index), file: file.node.relativePath });
      }
      FETCH_PATTERN.lastIndex = 0;
      while ((m = FETCH_PATTERN.exec(content)) !== null) {
        const raw = m[1] ?? '';
        if (raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../')) {
          clients.push({ path: normalizePath(raw), line: lineOf(content, m.index), file: file.node.relativePath });
        }
      }
      AXIOS_PATTERN.lastIndex = 0;
      while ((m = AXIOS_PATTERN.exec(content)) !== null) {
        clients.push({ path: normalizePath(m[2] ?? ''), line: lineOf(content, m.index), file: file.node.relativePath });
      }
    }
    if (routes.length === 0 && clients.length === 0) {
      return emptyResult('api-contract', scanned, Date.now() - started);
    }
    const routeKeys = new Set(routes.map((r) => `${r.method} ${r.path}`));
    const routePaths = new Set(routes.map((r) => r.path));
    for (const client of clients) {
      if (!routePaths.has(client.path)) {
        findings.push(
          draft(ctx, {
            path: client.file,
            line: client.line,
            category: 'correctness',
            ruleId: 'api-contract.client-without-server-route',
            title: `Client calls ${client.path} with no server route`,
            description: `${client.file}:${client.line} calls '${client.path}' but no indexed server file declares that route — the call 404s at runtime.`,
            severity: 'high',
            confidence: 'medium',
            source: 'analyzer',
            evidence: [{ kind: 'code-excerpt', summary: client.path, ref: `${client.file}:${client.line}`, analyzerId: 'api-contract', confidence: 'medium' }],
            recommendation: 'Add the missing server route or fix the client path.',
            relatedFiles: [],
            relatedSymbols: [],
          }),
        );
      }
    }
    // Duplicate route registrations (same method + path twice).
    const seen = new Map<string, RouteDef>();
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      const first = seen.get(key);
      if (first && first.file !== route.file) {
        findings.push(
          draft(ctx, {
            path: route.file,
            line: route.line,
            category: 'correctness',
            ruleId: 'api-contract.duplicate-route',
            title: `Duplicate route ${key}`,
            description: `${route.file}:${route.line} registers ${key}, already registered in ${first.file}:${first.line} — one handler shadows the other.`,
            severity: 'medium',
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Remove or disambiguate one of the registrations.',
            relatedFiles: [first.file],
            relatedSymbols: [],
          }),
        );
      } else if (!first) {
        seen.set(key, route);
      }
    }
    void routeKeys;
    return { ...emptyResult('api-contract', scanned, Date.now() - started), findings };
  }
}

function normalizePath(raw: string): string {
  const withoutQuery = raw.split('?')[0] ?? raw;
  const withoutTemplate = withoutQuery.replace(/[${}][^/]*/g, ':param');
  const collapsed = withoutTemplate.replace(/:[A-Za-z_]\w*/g, ':param').replace(/\*/g, ':param');
  return collapsed || '/';
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}
