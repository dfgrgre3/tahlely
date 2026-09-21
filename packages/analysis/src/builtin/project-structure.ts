import type { NewFinding } from '@tahlely/domain';
import type { Analyzer, AnalyzerContext, AnalyzerResult } from '../analyzer.js';
import { emptyResult } from '../analyzer.js';
import { draft } from './common.js';

/**
 * Project-structure analyzer: analyzes the project as a whole — missing
 * README/LICENSE/tests/CI, deep directory nesting, and mixed file naming.
 */
export class ProjectStructureAnalyzer implements Analyzer {
  readonly kind = 'project-structure' as const;
  readonly rulePrefix = 'project-structure.';
  readonly requiresAi = false;

  async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
    const started = Date.now();
    const findings: NewFinding[] = [];
    const rels = ctx.files.map((file) => file.node.relativePath);
    const lower = new Set(rels.map((rel) => rel.toLowerCase()));

    // Missing project-critical files.
    const critical = [
      {
        name: 'readme.md',
        ruleId: 'project-structure.missing-readme',
        title: 'No README.md',
        desc: 'The project has no README — contributors cannot understand or run it.',
        severity: 'medium' as const,
        fix: 'Add a README.md with: purpose, setup, usage, and contribution notes.',
      },
      {
        name: 'license',
        ruleId: 'project-structure.missing-license',
        title: 'No LICENSE file',
        desc: 'Without a license, the project is "all rights reserved" by default — nobody can legally use it.',
        severity: 'high' as const,
        fix: 'Add a LICENSE file (MIT, Apache-2.0, etc.).',
      },
      {
        name: '.gitignore',
        ruleId: 'project-structure.missing-gitignore',
        title: 'No .gitignore',
        desc: 'Without .gitignore, build artifacts and secrets are one commit away from exposure.',
        severity: 'high' as const,
        fix: 'Add a .gitignore covering node_modules, dist, build, .env, and IDE files.',
      },
    ];
    for (const item of critical) {
      const found = [...lower].some(
        (rel) => rel === item.name || rel.endsWith(`/${item.name}`) || rel.includes(item.name),
      );
      if (!found) {
        findings.push(
          draft(ctx, {
            path: '(project)',
            line: 1,
            category: 'configuration',
            ruleId: item.ruleId,
            title: item.title,
            description: item.desc,
            severity: item.severity,
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: item.fix,
            relatedFiles: [],
            relatedSymbols: [],
          }),
        );
      }
    }

    // Missing tests.
    const hasTests = rels.some(
      (rel) =>
        /(^|[/\\])(test|tests|__tests__|spec|e2e)([/\\]|$)/i.test(rel) ||
        /\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs|java|cs)$/i.test(rel),
    );
    if (rels.length >= 5 && !hasTests) {
      findings.push(
        draft(ctx, {
          path: '(project)',
          line: 1,
          category: 'correctness',
          ruleId: 'project-structure.no-tests',
          title: 'No test files or tests directory',
          description:
            'A project of this size with zero tests cannot be refactored or released safely.',
          severity: 'high',
          confidence: 'medium',
          source: 'analyzer',
          evidence: [],
          recommendation: 'Add a tests/ directory with at least smoke tests for critical paths.',
          relatedFiles: [],
          relatedSymbols: [],
        }),
      );
    }

    // Missing CI.
    const hasCI = rels.some(
      (rel) =>
        /(^|[/\\])\.github[/\\]workflows/i.test(rel) ||
        /(^|[/\\])\.gitlab-ci\.yml/i.test(rel) ||
        /(^|[/\\])\.circleci/i.test(rel) ||
        /(^|[/\\])jenkinsfile/i.test(rel) ||
        /(^|[/\\])\.travis\.yml/i.test(rel),
    );
    if (rels.length >= 5 && !hasCI) {
      findings.push(
        draft(ctx, {
          path: '(project)',
          line: 1,
          category: 'configuration',
          ruleId: 'project-structure.no-ci',
          title: 'No CI configuration detected',
          description:
            'No CI pipeline means broken code can be merged without any automated check.',
          severity: 'medium',
          confidence: 'high',
          source: 'analyzer',
          evidence: [],
          recommendation:
            'Add a CI workflow (GitHub Actions, GitLab CI, etc.) that runs tests on every push.',
          relatedFiles: [],
          relatedSymbols: [],
        }),
      );
    }

    // Deep directory nesting (> 6 levels).
    for (const rel of rels) {
      const depth = rel.split('/').length;
      if (depth > 6) {
        const node = ctx.files.find((f) => f.node.relativePath === rel)?.node;
        findings.push(
          draft(ctx, {
            path: rel,
            fileId: node?.id,
            line: 1,
            category: 'architecture',
            ruleId: 'project-structure.deep-nesting',
            title: `Deep directory nesting (${depth} levels)`,
            description: `${rel} is buried ${depth} levels deep — imports become unreadable and refactoring is painful.`,
            severity: 'low',
            confidence: 'high',
            source: 'analyzer',
            evidence: [],
            recommendation: 'Flatten the directory structure; group by feature, not by type.',
            relatedFiles: [],
            relatedSymbols: [],
          }),
        );
        break;
      }
    }

    // Mixed naming conventions per directory.
    const byDir = new Map<string, string[]>();
    for (const rel of rels) {
      const dir = rel.slice(0, rel.lastIndexOf('/'));
      const name = rel.split('/').pop() ?? rel;
      const existing = byDir.get(dir) ?? [];
      existing.push(name);
      byDir.set(dir, existing);
    }
    for (const [dir, names] of byDir) {
      const styles = new Set<string>();
      for (const name of names) {
        const base = name.replace(/\.[^.]+$/, '');
        if (/^[a-z][a-z0-9]*$/.test(base)) styles.add('lowercase');
        else if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(base)) styles.add('camelCase');
        else if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(base)) styles.add('snake_case');
        else if (/^[A-Z]/.test(base)) styles.add('PascalCase');
        else if (/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(base)) styles.add('kebab-case');
      }
      if (styles.size > 2 && names.length >= 4) {
        findings.push(
          draft(ctx, {
            path: dir || '(root)',
            line: 1,
            category: 'style',
            ruleId: 'project-structure.mixed-naming',
            title: `Mixed file naming in ${dir || 'root'} (${[...styles].join(', ')})`,
            description: `Files in ${dir || 'root'} mix ${[...styles].join(', ')} — pick one convention per directory.`,
            severity: 'info',
            confidence: 'medium',
            source: 'analyzer',
            evidence: [],
            recommendation:
              'Standardize file naming per directory (kebab-case or camelCase for code).',
            relatedFiles: names,
            relatedSymbols: [],
          }),
        );
      }
    }

    return { ...emptyResult('project-structure', rels.length, Date.now() - started), findings };
  }
}
