import { describe, expect, it } from 'vitest';
import { render } from '@tahlely/reporting';
import { buildToolProjectReport, runProjectAnalysis, services, waitForTask } from './bootstrap.js';
import { importUploadedFolder } from './folder-import.js';

describe('buildToolProjectReport', () => {
  it('produces a deterministic, per-file report straight from the analyzers', async () => {
    const project = await importUploadedFolder('Tool Report App', [
      {
        relativePath: 'package.json',
        content: JSON.stringify({ name: 'tool-app', dependencies: { lodash: '^4.0.0' } }),
      },
      {
        relativePath: 'src/broken.ts',
        content: [
          'import axios from "axios";',
          'export function run(value) {',
          '  if (value = 2) { missingThing(value); }',
          '  var x = 1;',
          '  return eval(value);',
          '}',
        ].join('\n'),
      },
      { relativePath: 'src/clean.ts', content: 'export const ok = true;\n' },
    ]);
    const task = await runProjectAnalysis(project.id, 'strict', 'tool-only');
    await waitForTask(task.id);

    const report = await buildToolProjectReport(project.id, { title: 'Tool audit' });
    expect(report.generatedBy).toBe('tool');
    expect(report.title).toBe('Tool audit');
    expect(report.findings.length).toBeGreaterThan(0);

    const ids = report.sections.map((section) => section.id);
    expect(ids).toContain('tool-overview');
    expect(ids).toContain('per-file-issues');
    expect(ids).toContain('clean-files');

    const markdown = render(report);
    expect(markdown).toContain('Deterministic analysis overview');
    expect(markdown).toContain('src/broken.ts');
    expect(markdown).toContain('deep-correctness.');
    expect(markdown).toContain('dependencies.undeclared-dependency');
    expect(markdown).toContain('Fix:');

    const stored = await services.reports.getReport(report.id);
    expect(stored?.id).toBe(report.id);
  });
});
