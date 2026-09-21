import type { NewFinding, Severity } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft, throwIfAborted } from './common.js';

const MAX_PER_FILE = 10;
const MAX_TOTAL = 100;

interface HygieneHit {
  line: number;
  ruleId: string;
  title: string;
  description: string;
  impact?: string;
  severity: Severity;
  confidence: 'high' | 'medium' | 'low';
  recommendation: string;
}

/**
 * Project-hygiene analyzer: filename-based and project-level risks that
 * linters never see — committed secrets files, private keys, build artifacts
 * in the index, Dockerfile anti-patterns, unpinned CI actions, missing
 * gitignore/lockfile/tests, and dependency manifest contradictions.
 */
export class ProjectHygieneAnalyzer implements Analyzer {
  readonly kind = 'hygiene' as const;
  readonly rulePrefix = 'hygiene.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    let scanned = 0;
    for (const file of ctx.files) {
      throwIfAborted(ctx);
      const rel = file.node.relativePath;
      const name = file.node.name.toLowerCase();
      const hits: HygieneHit[] = [];

      if (/(^|\/)\.env(\.|$)/.test(rel) || name === '.env') {
        hits.push({
          line: 1,
          ruleId: 'hygiene.committed-env-file',
          title: 'Environment file is indexed (.env)',
          description: `${rel} contains environment secrets and is tracked in the project — it can leak through commits, bundles, and deployments.`,
          impact: 'Credential exposure via version control or artifact sharing.',
          severity: 'critical',
          confidence: 'high',
          recommendation:
            'Gitignore .env files now, rotate any exposed values, and use a secret manager.',
        });
      }
      if (/\.(pem|key|p12|pfx)$/i.test(name) || /(^|\/)(id_rsa|id_dsa)(_|$|\.)/i.test(rel)) {
        hits.push({
          line: 1,
          ruleId: 'hygiene.private-key-file',
          title: 'Private key material stored in the project',
          description: `${rel} looks like a private key or certificate bundle checked into the project.`,
          impact: 'Full impersonation of the key owner if the repo is shared.',
          severity: 'critical',
          confidence: 'high',
          recommendation:
            'Remove the file from history, rotate the key, and mount secrets at runtime.',
        });
      }
      if (/^(node_modules|dist|build|coverage|target|vendor|\.next)\//.test(rel)) {
        hits.push({
          line: 1,
          ruleId: 'hygiene.build-artifact-indexed',
          title: 'Build artifact or dependency directory is indexed',
          description: `${rel} lives under a directory that should never be analyzed or committed.`,
          severity: 'medium',
          confidence: 'high',
          recommendation: 'Add the directory to .gitignore and the analyzer ignore rules.',
        });
      }

      if (file.content !== undefined && !file.node.binary) {
        const lines = file.content.split('\n');
        if (/^dockerfile(\.|$)/i.test(name) || /(^|\/)dockerfile(\.|$)/i.test(rel)) {
          hits.push(...dockerfileChecks(lines));
        }
        if (/\.github\/workflows\/.+\.ya?ml$/i.test(rel)) {
          hits.push(...workflowChecks(lines));
        }
        scanned += 1;
      }

      for (const hit of hits.slice(0, MAX_PER_FILE)) {
        if (findings.length >= MAX_TOTAL) break;
        findings.push(
          draft(ctx, {
            path: rel,
            fileId: file.node.id,
            line: hit.line,
            category:
              hit.ruleId.includes('env') || hit.ruleId.includes('key')
                ? 'security'
                : 'configuration',
            ruleId: hit.ruleId,
            title: hit.title,
            description: hit.description,
            impact: hit.impact,
            severity: hit.severity,
            confidence: hit.confidence,
            source: 'analyzer',
            evidence: [],
            recommendation: hit.recommendation,
            relatedFiles: [],
            relatedSymbols: [],
          }),
        );
      }
    }

    findings.push(...this.projectLevelChecks(ctx, findings.length));
    return { ...emptyResult('hygiene', scanned, Date.now() - started), findings };
  }

  private projectLevelChecks(ctx: AnalyzerContext, current: number): NewFinding[] {
    const out: NewFinding[] = [];
    const rels = new Set(ctx.files.map((file) => file.node.relativePath));
    const push = (partial: Omit<NewFinding, 'projectId' | 'analysisId'>): void => {
      if (current + out.length >= MAX_TOTAL) return;
      out.push(draft(ctx, partial));
    };

    if (!hasFile(rels, '.gitignore') && !hasFile(rels, '.git/info/exclude')) {
      push({
        path: '(project)',
        line: 1,
        category: 'configuration',
        ruleId: 'hygiene.missing-gitignore',
        title: 'No .gitignore file',
        description:
          'Without a .gitignore, build output, dependencies, and local secrets are one commit away from exposure.',
        severity: 'high',
        confidence: 'high',
        source: 'analyzer',
        evidence: [],
        recommendation: 'Add a .gitignore covering node_modules, dist, build, .env, and IDE files.',
        relatedFiles: [],
        relatedSymbols: [],
      });
    }

    const manifest = ctx.files.find((file) => file.node.name === 'package.json');
    if (manifest) {
      const raw = manifest.content ?? '{}';
      let parsed: { scripts?: Record<string, string>; dependencies?: Record<string, string> } = {};
      let ok = true;
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        ok = false;
      }
      if (ok) {
        if (!parsed.scripts?.['test']) {
          push({
            path: manifest.node.relativePath,
            fileId: manifest.node.id,
            line: 1,
            category: 'configuration',
            ruleId: 'hygiene.missing-test-script',
            title: 'package.json has no test script',
            description: 'CI and contributors have no standard way to verify the project.',
            severity: 'medium',
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Add a "test" script — even a placeholder that runs the suite.',
            relatedFiles: [],
            relatedSymbols: [],
          });
        }
        if (
          !hasFile(rels, 'package-lock.json') &&
          !hasFile(rels, 'yarn.lock') &&
          !hasFile(rels, 'pnpm-lock.yaml')
        ) {
          push({
            path: manifest.node.relativePath,
            fileId: manifest.node.id,
            line: 1,
            category: 'configuration',
            ruleId: 'hygiene.missing-lockfile',
            title: 'No lockfile committed',
            description:
              'Without a lockfile, every install can resolve different dependency versions.',
            impact: 'Non-reproducible builds and surprise breakages.',
            severity: 'medium',
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Commit package-lock.json / pnpm-lock.yaml / yarn.lock.',
            relatedFiles: [],
            relatedSymbols: [],
          });
        }
        for (const name of Object.keys(parsed.dependencies ?? {})) {
          if (name.startsWith('@types/') || name.startsWith('@tsconfig/')) {
            push({
              path: manifest.node.relativePath,
              fileId: manifest.node.id,
              line: 1,
              category: 'dependencies',
              ruleId: 'hygiene.types-in-dependencies',
              title: `Type package in dependencies: ${name}`,
              description: `${name} ships no runtime code and belongs in devDependencies.`,
              severity: 'low',
              confidence: 'high',
              source: 'analyzer',
              evidence: [],
              recommendation: `Move ${name} to devDependencies.`,
              relatedFiles: [],
              relatedSymbols: [name],
            });
          }
        }
      }
    }

    const tests = [...rels].filter((rel) =>
      /(^|[./_-])(test|tests|spec|__tests__)([./_-]|$)/i.test(rel),
    );
    if (ctx.files.length >= 5 && tests.length === 0) {
      push({
        path: '(project)',
        line: 1,
        category: 'correctness',
        ruleId: 'hygiene.no-test-files',
        title: 'No test files detected',
        description:
          'A project of this size with zero tests cannot be refactored or released safely.',
        severity: 'high',
        confidence: 'medium',
        source: 'analyzer',
        evidence: [],
        recommendation: 'Add tests for the critical paths first, then expand coverage.',
        relatedFiles: [],
        relatedSymbols: [],
      });
    }
    return out;
  }
}

function hasFile(rels: Set<string>, name: string): boolean {
  return [...rels].some((rel) => rel === name || rel.toLowerCase() === name);
}

/** Dockerfile anti-patterns with exact line numbers. */
function dockerfileChecks(lines: string[]): HygieneHit[] {
  const hits: HygieneHit[] = [];
  let seenFrom = false;
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const cleaned = line.split('#')[0] ?? '';
    if (/^\s*FROM\s+/i.test(cleaned)) {
      seenFrom = true;
      if (/:\s*latest(\s|$)/i.test(cleaned) || !/:\S+/.test(cleaned.split(/\s+/)[1] ?? '')) {
        hits.push({
          line: lineNo,
          ruleId: 'hygiene.docker-latest-tag',
          title: 'Docker image uses :latest or an unpinned tag',
          description: `Line ${lineNo} pulls a floating base image — rebuilds can silently change behavior.`,
          impact: 'Non-reproducible images and surprise breakages.',
          severity: 'medium',
          confidence: 'high',
          recommendation: 'Pin the base image to an exact digest or minor version.',
        });
      }
    }
    if (/^\s*USER\s+root\b/i.test(cleaned) || (/^\s*USER\b/i.test(cleaned) && !seenFrom)) {
      hits.push({
        line: lineNo,
        ruleId: 'hygiene.docker-root-user',
        title: 'Container runs as root',
        description: `Line ${lineNo} runs the container as root — a breakout gives host-level privileges.`,
        impact: 'Privilege escalation on container escape.',
        severity: 'high',
        confidence: 'high',
        recommendation: 'Create a non-root USER and switch to it before CMD/ENTRYPOINT.',
      });
    }
    if (/^\s*ADD\s+(https?:|\S*\.tar)/i.test(cleaned)) {
      hits.push({
        line: lineNo,
        ruleId: 'hygiene.docker-add-remote',
        title: 'ADD with remote URL or archive',
        description: `Line ${lineNo} fetches remote content at build time without verification.`,
        severity: 'medium',
        confidence: 'high',
        recommendation: 'Use COPY for local files; download + verify checksums explicitly instead.',
      });
    }
    if (/apt-get\s+install\b/i.test(cleaned) && !/apt-get\s+update/i.test(cleaned)) {
      hits.push({
        line: lineNo,
        ruleId: 'hygiene.docker-apt-no-update',
        title: 'apt-get install without update in the same layer',
        description: `Line ${lineNo} installs packages from a stale index, or caches a broken layer.`,
        severity: 'low',
        confidence: 'medium',
        recommendation: 'Chain `apt-get update && apt-get install -y` in one RUN step.',
      });
    }
  });
  return hits;
}

/** GitHub Actions hygiene with exact line numbers. */
function workflowChecks(lines: string[]): HygieneHit[] {
  const hits: HygieneHit[] = [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const uses = /^\s*-\s*uses:\s*([^\s#]+)/.exec(line);
    if (uses && /@v?\d+(\.\d+)?$/.test(uses[1]!) && !/@[0-9a-f]{40}/.test(uses[1]!)) {
      hits.push({
        line: lineNo,
        ruleId: 'hygiene.gha-unpinned-action',
        title: `Third-party action not pinned to a commit SHA (${uses[1]})`,
        description: `Line ${lineNo} trusts a mutable tag — a compromised tag update runs attacker code in CI.`,
        impact: 'Supply-chain execution inside CI with repo credentials.',
        severity: 'high',
        confidence: 'medium',
        recommendation:
          'Pin third-party actions to a full commit SHA (use a comment for the version).',
      });
    }
    if (/pull-requests\s*:\s*write/i.test(line)) {
      hits.push({
        line: lineNo,
        ruleId: 'hygiene.gha-broad-token',
        title: 'Workflow grants broad pull-requests: write permission',
        description: `Line ${lineNo} hands every job in the workflow write access over pull requests.`,
        severity: 'medium',
        confidence: 'high',
        recommendation: 'Scope permissions per-job and prefer the least privilege needed.',
      });
    }
  });
  return hits;
}
