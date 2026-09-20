import { describe, expect, it } from 'vitest';
import { MemoryFileSystem, indexProject } from '@tahlely/infrastructure';
import type { ProjectId } from '@tahlely/domain';

describe('indexer', () => {
  it('walks metadata-only with ignore support', async () => {
    const fs = new MemoryFileSystem({
      '/repo/src/index.ts': 'export const x = 1;\n',
      '/repo/src/util.ts': 'export const y = 2;\n',
      '/repo/node_modules/dep/index.js': 'module.exports = {};\n',
      '/repo/.gitignore': 'ignored/\n',
      '/repo/ignored/skip.ts': 'export const z = 3;\n',
    });
    const outcome = await indexProject(fs, 'prj_1' as ProjectId, '/repo', {
      maxFiles: 100,
      maxFileSizeBytes: 1024 * 1024,
      extraIgnores: [],
      respectGitignore: true,
    });
    const paths = outcome.files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['.gitignore', 'src/index.ts', 'src/util.ts']);
    expect(outcome.skippedIgnored).toBeGreaterThanOrEqual(2);
    expect(outcome.files[0]?.relativePath).toBe('src/index.ts');
  });

  it('aborts on cancellation', async () => {
    const fs = new MemoryFileSystem({ '/repo/a.ts': 'x' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      indexProject(fs, 'prj_1' as ProjectId, '/repo', {
        maxFiles: 100,
        maxFileSizeBytes: 1024,
        extraIgnores: [],
        respectGitignore: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
