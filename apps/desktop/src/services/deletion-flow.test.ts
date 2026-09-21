import { describe, expect, it } from 'vitest';
import {
  decideApproval,
  listProjectFiles,
  readProjectFile,
  requestFileDeletion,
  services,
} from './bootstrap.js';
import { importUploadedFolder } from './folder-import.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('permission-gated deletion flow', () => {
  it('attaches a decision note and applies approved deletions only', async () => {
    const project = await importUploadedFolder('Flow App', [
      { relativePath: 'src/keep.ts', content: 'export const keep = 1;\n' },
      { relativePath: 'src/dup.ts', content: 'export const dup = 1;\n' },
    ]);

    // Rejected request: file must survive.
    await requestFileDeletion(project.id, 'src/dup.ts', 'duplicate of keep.ts');
    let pending = await services.policies.listPendingRequests(project.id);
    let request = pending.find((r) => r.target === 'src/dup.ts')!;
    await decideApproval(request.id, false, 'not yet — still referenced');
    await tick();
    const decided = await services.policies.getRequest(request.id);
    expect(decided?.status).toBe('rejected');
    expect(decided?.decisionNote).toBe('not yet — still referenced');
    await expect(readProjectFile(project.id, `${project.rootPath}/src/dup.ts`)).resolves.toContain(
      'dup',
    );

    // Approved request: file is deleted from fs and index.
    await requestFileDeletion(project.id, 'src/dup.ts', 'duplicate of keep.ts');
    pending = await services.policies.listPendingRequests(project.id);
    request = pending.find((r) => r.target === 'src/dup.ts')!;
    await decideApproval(request.id, true, 'safe to remove');
    await tick();
    await expect(readProjectFile(project.id, `${project.rootPath}/src/dup.ts`)).rejects.toThrow();
    const files = await listProjectFiles(project.id);
    expect(files.some((f) => f.relativePath === 'src/dup.ts')).toBe(false);
    expect(files.some((f) => f.relativePath === 'src/keep.ts')).toBe(true);
  });
});
