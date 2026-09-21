import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, normalizedExtension, throwIfAborted } from './common.js';

const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'java', 'cs', 'rs', 'php', 'rb']);

function relativeImports(content: string): string[] {
  const out: string[] = [];
  const patterns = [
    /(?:import|from)\s+['"](\.[^'"]+)['"]/g,
    /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /from\s+[\w.]+\s+import\s+/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      if (m[1]) out.push(m[1]);
    }
  }
  // Python relative: from . import x / from .mod import y
  const pyPattern = /^\s*from\s+(\.+[\w.]*)\s+import\s+/gm;
  let pm: RegExpExecArray | null;
  while ((pm = pyPattern.exec(content)) !== null) {
    if (pm[1]) out.push(pm[1]);
  }
  return out;
}

function resolveRelative(fromRel: string, spec: string, fileSet: Set<string>): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const dirParts = fromRel.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') dirParts.pop();
    else dirParts.push(part);
  }
  const base = dirParts.join('/');
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.py`, `${base}/index.ts`, `${base}/index.js`, `${base}/__init__.py`];
  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }
  return undefined;
}

/**
 * Real architecture analysis: builds the project's own import graph from
 * relative imports resolved against the indexed file set, then reports
 * genuine structural defects — import cycles (DFS), missing local targets,
 * and hub files with excessive fan-in/fan-out.
 */
export class ArchitectureAnalyzer implements Analyzer {
  readonly kind = 'architecture' as const;
  readonly rulePrefix = 'architecture.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    const files = ctx.files.filter(
      (f) => !f.node.binary && !f.node.generated && f.content !== undefined && CODE_EXTS.has(normalizedExtension(f.node)),
    );
    if (files.length === 0) return emptyResult('architecture', 0, Date.now() - started);
    const fileSet = new Set(files.map((f) => f.node.relativePath));
    const graph = new Map<string, string[]>();
    for (const file of files) {
      throwIfAborted(ctx);
      const specs = relativeImports(file.content as string);
      const edges: string[] = [];
      for (const spec of specs) {
        const resolved = resolveRelative(file.node.relativePath, spec, fileSet);
        if (resolved) {
          edges.push(resolved);
        } else if (spec.startsWith('.')) {
          findings.push(
            draft(ctx, {
              path: file.node.relativePath,
              fileId: file.node.id,
              line: 1,
              category: 'architecture',
              ruleId: 'architecture.missing-local-import',
              title: `Local import target not found: ${spec}`,
              description: `${file.node.relativePath} imports '${spec}' but no indexed file resolves to it — the module is missing or the path is wrong.`,
              severity: 'high',
              confidence: 'high',
              source: 'analyzer',
              evidence: [{ kind: 'analyzer', summary: spec, confidence: 'high' }],
              recommendation: 'Fix the import path or add the missing module file.',
              relatedFiles: [],
              relatedSymbols: [],
            }),
          );
        }
      }
      graph.set(file.node.relativePath, edges);
    }

    // Cycle detection (iterative DFS with stack).
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const reportedCycles = new Set<string>();
    const visit = (node: string): void => {
      visited.add(node);
      onStack.add(node);
      stack.push(node);
      for (const next of graph.get(node) ?? []) {
        if (!visited.has(next)) {
          visit(next);
        } else if (onStack.has(next)) {
          const cycle = [...stack.slice(stack.indexOf(next)), next];
          const key = [...cycle].sort().join('>');
          if (!reportedCycles.has(key)) {
            reportedCycles.add(key);
            findings.push(
              draft(ctx, {
                path: node,
                line: 1,
                category: 'architecture',
                ruleId: 'architecture.import-cycle',
                title: `Import cycle: ${cycle.join(' → ')}`,
                description: `These modules import each other in a cycle (${cycle.join(' → ')}) — cycles prevent independent testing and cause initialization-order bugs.`,
                severity: 'high',
                confidence: 'high',
                source: 'analyzer',
                evidence: cycle.map((p) => ({ kind: 'analyzer' as const, summary: p, confidence: 'high' as const })),
                recommendation: 'Break the cycle by extracting shared code into a third module both can import.',
                relatedFiles: cycle,
                relatedSymbols: [],
              }),
            );
          }
        }
      }
      stack.pop();
      onStack.delete(node);
    };
    for (const node of graph.keys()) {
      if (!visited.has(node)) visit(node);
    }

    // Hub detection: real fan-in/fan-out counts from the resolved graph.
    const fanIn = new Map<string, number>();
    for (const edges of graph.values()) {
      for (const target of edges) fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
    }
    for (const [node, edges] of graph) {
      const out = edges.length;
      const inc = fanIn.get(node) ?? 0;
      if (out + inc >= 12 && files.length >= 10) {
        findings.push(
          draft(ctx, {
            path: node,
            line: 1,
            category: 'architecture',
            ruleId: 'architecture.hub-module',
            title: `Hub module (fan-in ${inc}, fan-out ${out})`,
            description: `${node} is coupled to ${out + inc} modules — changes here ripple across the project.`,
            severity: 'medium',
            confidence: 'medium',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Split responsibilities behind narrower interfaces.',
            relatedFiles: edges.slice(0, 10),
            relatedSymbols: [],
          }),
        );
      }
    }
    return { ...emptyResult('architecture', files.length, Date.now() - started), findings };
  }
}
