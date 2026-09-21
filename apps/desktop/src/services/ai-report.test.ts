import { describe, expect, it } from 'vitest';
import { buildAiProjectReport, services } from './bootstrap.js';
import { importUploadedFolder } from './folder-import.js';
import { runProjectAnalysis, waitForTask } from './bootstrap.js';

describe('buildAiProjectReport', () => {
  it('produces an AI report grounded in the strict analysis findings', async () => {
    const project = await importUploadedFolder('AI Report App', [
      {
        relativePath: 'src/auth.ts',
        content: [
          'export function login(input: string): boolean {',
          '  debugger;',
          '  var password = "super-secret-value";',
          '  if (input == "admin") { console.log(input); }',
          '  return eval(input) as any;',
          '}',
        ].join('\n'),
      },
      { relativePath: 'src/util.ts', content: 'export const util = 1;\n' },
    ]);
    const task = await runProjectAnalysis(project.id, 'strict', 'tool-only');
    await waitForTask(task.id);

    const report = await buildAiProjectReport(project.id, { title: 'Audit report' });
    expect(report.generatedBy).toBe('ai');
    expect(report.title).toBe('Audit report');
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.sections[0]?.id).toBe('ai-summary');
    expect(report.sections.some((section) => section.id === 'ai-comprehensive')).toBe(true);
    expect(report.sections[0]?.body).toContain('Findings:');

    const stored = await services.reports.getReport(report.id);
    expect(stored?.id).toBe(report.id);
  });

  it('still reports cleanly when no analysis has run', async () => {
    const project = await importUploadedFolder('Fresh App', [
      { relativePath: 'src/index.ts', content: 'export const ok = true;\n' },
    ]);
    const report = await buildAiProjectReport(project.id);
    expect(report.findings).toHaveLength(0);
    expect(report.sections.some((section) => section.id === 'ai-comprehensive')).toBe(true);
  });
});
