import { describe, expect, it } from 'vitest';
import type { FileNode } from '@tahlely/domain';
import { newId } from '@tahlely/domain';
import type { AnalyzerContext } from '../src/analyzer.js';
import { UniversalAnalyzer } from '../src/builtin/universal-analyzer.js';
import { ProjectStructureAnalyzer } from '../src/builtin/project-structure.js';

function node(relativePath: string, extension: string): FileNode {
  return {
    id: newId('file'),
    projectId: 'p1' as FileNode['projectId'],
    path: `/p/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    extension,
    language: 'typescript',
    size: 10,
    ignored: false,
    generated: false,
    binary: false,
    analyzed: false,
    importance: 0,
    risk: 0,
  };
}

function ctx(files: { path: string; ext: string; content: string }[]): AnalyzerContext {
  return {
    analysisId: 'a1' as AnalyzerContext['analysisId'],
    projectId: 'p1' as AnalyzerContext['projectId'],
    projectRoot: '/p',
    files: files.map((file) => ({ node: node(file.path, file.ext), content: file.content })),
  };
}

describe('UniversalAnalyzer (every file type)', () => {
  it('validates JSON, YAML, HTML, CSS, SQL, shell, and polyglot code', async () => {
    const result = await new UniversalAnalyzer().analyze(
      ctx([
        { path: 'config/settings.json', ext: 'json', content: '{"a": 1,}' },
        { path: 'config/app.yml', ext: 'yml', content: 'key:\n\tvalue: 1' },
        {
          path: 'public/index.html',
          ext: 'html',
          content: '<html><head></head><body><img src="x.png" onclick="go()"></body></html>',
        },
        {
          path: 'public/app.css',
          ext: 'css',
          content: '.a { width: 120px !important; height: 40px !important; }',
        },
        { path: 'db/reset.sql', ext: 'sql', content: 'DELETE FROM users;\nSELECT * FROM orders;' },
        { path: 'scripts/deploy.sh', ext: 'sh', content: 'rm -rf $TARGET\ncurl -sL x | sh' },
        {
          path: 'main.go',
          ext: 'go',
          content: 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi"); panic("x") }',
        },
        { path: 'lib.rs', ext: 'rs', content: 'pub fn get() -> i32 { maybe().unwrap() }' },
        {
          path: 'App.java',
          ext: 'java',
          content: 'class A { void f() { try {} catch (Exception e) {} System.out.println(1); } }',
        },
        {
          path: 'Prog.cs',
          ext: 'cs',
          content: 'class P { void M() { Console.WriteLine(); unsafe { } } }',
        },
        { path: 'docs/stub.md', ext: 'md', content: '## Hi' },
      ]),
    );
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('universal.json-invalid');
    expect(rules).toContain('universal.yaml-tabs');
    expect(rules).toContain('universal.html-missing-alt');
    expect(rules).toContain('universal.html-inline-handler');
    expect(rules).toContain('universal.css-important-overuse');
    expect(rules).toContain('universal.sql-delete-without-where');
    expect(rules).toContain('universal.sql-select-star');
    expect(rules).toContain('universal.shell-rm-rf');
    expect(rules).toContain('universal.shell-curl-pipe-sh');
    expect(rules).toContain('universal.go-panic-in-library');
    expect(rules).toContain('universal.rust-unwrap-overuse');
    expect(rules).toContain('universal.java-empty-catch');
    expect(rules).toContain('universal.java-system-out');
    expect(rules).toContain('universal.csharp-console-write');
    expect(rules).toContain('universal.csharp-unsafe');
    expect(rules).toContain('universal.markdown-empty');
    const invalid = result.findings.find((f) => f.ruleId === 'universal.json-invalid')!;
    expect(invalid.severity).toBe('critical');
    expect(result.findings.every((f) => f.line !== undefined && f.line > 0)).toBe(true);
  });
});

describe('ProjectStructureAnalyzer (the whole project)', () => {
  it('flags missing README, LICENSE, tests, CI, and mixed naming', async () => {
    const result = await new ProjectStructureAnalyzer().analyze(
      ctx([
        { path: 'package.json', ext: 'json', content: '{}' },
        { path: 'src/index.ts', ext: 'ts', content: 'export const a = 1;\n' },
        { path: 'src/Helper.ts', ext: 'ts', content: 'export const b = 2;\n' },
        { path: 'src/my-file.ts', ext: 'ts', content: 'export const c = 3;\n' },
        { path: 'src/utils_helper.ts', ext: 'ts', content: 'export const d = 4;\n' },
        { path: 'src/lowercase.ts', ext: 'ts', content: 'export const e = 5;\n' },
        {
          path: 'a/very/deep/nested/folder/structure/here/file.ts',
          ext: 'ts',
          content: 'export const f = 6;\n',
        },
      ]),
    );
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('project-structure.missing-readme');
    expect(rules).toContain('project-structure.missing-license');
    expect(rules).toContain('project-structure.missing-gitignore');
    expect(rules).toContain('project-structure.no-tests');
    expect(rules).toContain('project-structure.no-ci');
    expect(rules).toContain('project-structure.deep-nesting');
    expect(rules).toContain('project-structure.mixed-naming');
  });

  it('stays quiet for a complete, well-structured project', async () => {
    const result = await new ProjectStructureAnalyzer().analyze(
      ctx([
        { path: 'README.md', ext: 'md', content: '# App' },
        { path: 'LICENSE', ext: '', content: 'MIT' },
        { path: '.gitignore', ext: '', content: 'node_modules' },
        { path: 'package.json', ext: 'json', content: '{}' },
        { path: 'src/index.ts', ext: 'ts', content: 'export const a = 1;\n' },
        { path: 'tests/index.test.ts', ext: 'ts', content: 'expect(1).toBe(1);' },
        { path: '.github/workflows/ci.yml', ext: 'yml', content: 'on: push' },
      ]),
    );
    expect(result.findings).toHaveLength(0);
  });
});
