import { describe, expect, it } from 'vitest';
import {
  analyzeSnippetFile,
  deriveReportTitle,
  guessSnippetPurpose,
  languageForFileName,
} from './file-analyzer.js';
import { loadDemoProject, services } from './bootstrap.js';

const BAD_TS = [
  'import { helper } from "./util";',
  'export const password = "hardcoded-secret";',
  'export function run(input: string): unknown {',
  '  return eval(input);',
  '}',
  '',
].join('\n');

describe('deriveReportTitle', () => {
  it('uses the file name when provided', () => {
    expect(deriveReportTitle('const x = 1;', 'auth.ts')).toBe('Analysis: auth.ts');
  });

  it('derives a name from the first meaningful line for pasted text', () => {
    const title = deriveReportTitle('// comment\n\nfunction loginUser() {', undefined);
    expect(title).toContain('Snippet report:');
    expect(title).toContain('function loginUser');
  });

  it('falls back for empty content', () => {
    expect(deriveReportTitle('   \n  ', undefined)).toBe('Analysis: empty snippet');
  });
});

describe('guessSnippetPurpose / languageForFileName', () => {
  it('detects a TS module', () => {
    expect(guessSnippetPurpose(BAD_TS)).toBe('JavaScript/TypeScript module');
  });

  it('detects SQL', () => {
    expect(guessSnippetPurpose('SELECT * FROM users WHERE id = 1')).toBe('SQL query');
  });

  it('maps extensions to languages', () => {
    expect(languageForFileName('a.tsx')).toBe('typescript');
    expect(languageForFileName('a.py')).toBe('python');
    expect(languageForFileName('Makefile')).toBe('unknown');
  });
});

describe('analyzeSnippetFile', () => {
  it('runs tool analysis, produces findings with line numbers, and persists a report', async () => {
    const project = await loadDemoProject();
    const { report, conversationId } = await analyzeSnippetFile({
      projectId: project.id,
      content: BAD_TS,
      fileName: 'bad.ts',
      source: 'paste',
      mode: 'tool',
    });
    expect(conversationId).toBeTruthy();
    expect(report.conversationId).toBe(conversationId);
    expect(report.generatedBy).toBe('tool');
    expect(report.title).toBe('Analysis: bad.ts');
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.some((f) => typeof f.line === 'number' && f.line > 0)).toBe(true);
    expect(report.sections[0]?.id).toBe('input');
    const stored = await services.reports.getReport(report.id);
    expect(stored?.id).toBe(report.id);
  });

  it('adds an AI Review section in hybrid mode', async () => {
    const project = await loadDemoProject();
    const { report, aiReview } = await analyzeSnippetFile({
      projectId: project.id,
      content: 'export const x: number = 1;\n',
      source: 'paste',
      mode: 'both',
    });
    expect(report.generatedBy).toBe('hybrid');
    expect(aiReview).toBeTruthy();
    expect(report.sections.some((s) => s.id === 'ai-review')).toBe(true);
    expect(report.title.startsWith('Snippet report:')).toBe(true);
  });

  it('rejects empty content', async () => {
    const project = await loadDemoProject();
    await expect(
      analyzeSnippetFile({ projectId: project.id, content: '  ', source: 'paste', mode: 'tool' }),
    ).rejects.toThrow('Nothing to analyze');
  });
});
