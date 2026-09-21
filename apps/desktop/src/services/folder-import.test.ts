import { describe, expect, it } from 'vitest';
import { importUploadedFolder, shouldSkipUpload } from './folder-import.js';
import { listProjectFiles, readProjectFile, services } from './bootstrap.js';

describe('shouldSkipUpload', () => {
  it('skips binaries and oversized files', () => {
    expect(shouldSkipUpload('logo.png', 100)).toBe(true);
    expect(shouldSkipUpload('big.ts', 2 * 1024 * 1024)).toBe(true);
    expect(shouldSkipUpload('index.ts', 500)).toBe(false);
  });
});

describe('importUploadedFolder', () => {
  it('registers, discovers, indexes, and makes files readable', async () => {
    const project = await importUploadedFolder('My App', [
      { relativePath: 'package.json', content: '{"name":"my-app","main":"src/index.ts"}' },
      { relativePath: 'src/index.ts', content: 'export const main = 1;\n' },
      { relativePath: 'src/util/deep.ts', content: 'export const deep = 2;\n' },
    ]);
    expect(project.name).toBe('My App');
    expect(project.rootPath).toContain('/uploads/my-app');

    const files = await listProjectFiles(project.id);
    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toContain('package.json');
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/util/deep.ts');

    const content = await readProjectFile(project.id, `${project.rootPath}/src/index.ts`);
    expect(content).toContain('main');

    const stored = await services.projects.getProject(project.id);
    expect(stored?.kind).toBe('node');
  });

  it('rejects an empty upload', async () => {
    await expect(importUploadedFolder('Empty', [])).rejects.toThrow('no readable text files');
  });
});
