import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture boundary test — the executable form of the layering rules.
 * Fails the build if a module reaches across its boundary, so Prompt 2+
 * cannot silently couple UI → filesystem, packages → UI, or domain → anything.
 */
const ROOT = nodePath.resolve(__dirname, '..', '..');

const ALLOWED_PACKAGE_DEPS: Record<string, string[]> = {
  domain: [],
  application: ['@tahlely/domain'],
  security: ['@tahlely/domain'],
  infrastructure: ['@tahlely/domain', '@tahlely/application', '@tahlely/security'],
  analysis: ['@tahlely/domain', '@tahlely/application'],
  ai: ['@tahlely/domain', '@tahlely/security'],
  agents: ['@tahlely/domain', '@tahlely/application', '@tahlely/ai', '@tahlely/security'],
  execution: ['@tahlely/domain', '@tahlely/application', '@tahlely/security'],
  reporting: ['@tahlely/domain'],
  persistence: ['@tahlely/domain', '@tahlely/application'],
};

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = nodePath.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...listSourceFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function workspaceImports(file: string): string[] {
  const content = readFileSync(file, 'utf8');
  const matches = content.match(/from\s+['"](@tahlely\/[^'"]+)['"]/g) ?? [];
  return matches.map((m) =>
    m
      .replace(/from\s+['"]/, '')
      .replace(/['"]$/, '')
      .replace(/\/(node|memory)$/, ''),
  );
}

/** Node-only modules excluded from the web-bundle safety check. */
const NODE_ONLY_FILES = new Set([
  'node-fs.ts',
  'executor.ts',
  'json-repositories.ts',
  'factory.ts',
]);

describe('module boundaries', () => {
  it('declares only allowed workspace dependencies', () => {
    for (const [pkg, allowed] of Object.entries(ALLOWED_PACKAGE_DEPS)) {
      const manifest = JSON.parse(
        readFileSync(nodePath.join(ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> };
      const declared = Object.keys(manifest.dependencies ?? {}).filter((d) =>
        d.startsWith('@tahlely/'),
      );
      for (const dep of declared) {
        expect(allowed, `${pkg} must not depend on ${dep}`).toContain(dep);
      }
    }
  });

  it('imports only declared workspace dependencies in src/', () => {
    for (const [pkg, allowed] of Object.entries(ALLOWED_PACKAGE_DEPS)) {
      const dir = nodePath.join(ROOT, 'packages', pkg, 'src');
      for (const file of listSourceFiles(dir)) {
        for (const imported of workspaceImports(file)) {
          expect(allowed, `${nodePath.relative(ROOT, file)} must not import ${imported}`).toContain(
            imported,
          );
        }
      }
    }
  });

  it('keeps domain free of runtime platform imports', () => {
    const dir = nodePath.join(ROOT, 'packages', 'domain', 'src');
    for (const file of listSourceFiles(dir)) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/from\s+['"]node:/);
      expect(content, file).not.toMatch(/from\s+['"]react['"]/);
    }
  });

  it('keeps packages free of UI framework imports', () => {
    for (const pkg of Object.keys(ALLOWED_PACKAGE_DEPS)) {
      if (pkg === 'domain') continue;
      const dir = nodePath.join(ROOT, 'packages', pkg, 'src');
      for (const file of listSourceFiles(dir)) {
        const content = readFileSync(file, 'utf8');
        expect(content, file).not.toMatch(/from\s+['"]react['"]/);
      }
    }
  });

  it('keeps browser-safe modules free of node: imports', () => {
    for (const pkg of Object.keys(ALLOWED_PACKAGE_DEPS)) {
      const dir = nodePath.join(ROOT, 'packages', pkg, 'src');
      for (const file of listSourceFiles(dir)) {
        if (NODE_ONLY_FILES.has(nodePath.basename(file))) continue;
        const content = readFileSync(file, 'utf8');
        expect(content, file).not.toMatch(/from\s+['"]node:/);
      }
    }
  });
});
