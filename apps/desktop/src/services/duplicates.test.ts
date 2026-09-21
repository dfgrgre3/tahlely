import { describe, expect, it } from 'vitest';
import type { FileNode } from '@tahlely/domain';
import { newId } from '@tahlely/domain';
import { findDuplicateGroups, lineSimilarity, normalizeContent } from './duplicates.js';

function makeNode(relativePath: string, size = 100): FileNode {
  return {
    id: newId('file'),
    projectId: 'p1' as FileNode['projectId'],
    path: `/p/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    extension: 'ts',
    language: 'typescript',
    size,
    ignored: false,
    generated: false,
    binary: false,
    analyzed: false,
    importance: 0,
    risk: 0,
  };
}

const AUTH_V1 = [
  'export function login(user: string, pass: string): boolean {',
  '  return user === "admin" && pass.length > 3;',
  '}',
  'export function logout(): void {',
  '  sessionStorage.clear();',
  '}',
].join('\n');

const AUTH_V2 = [
  '// legacy copy — missing logout, keeps the same login logic',
  'export function login(user: string, pass: string): boolean {',
  '  return user === "admin" && pass.length > 3;',
  '}',
].join('\n');

describe('normalizeContent / lineSimilarity', () => {
  it('strips comments and collapses whitespace', () => {
    expect(normalizeContent('const a = 1; // hi')).toBe('const a = 1;');
    expect(normalizeContent('const   a\n=\n1;')).toBe('const a = 1;');
  });

  it('scores overlap between 0 and 1', () => {
    expect(lineSimilarity(AUTH_V1, AUTH_V1)).toBe(1);
    expect(lineSimilarity(AUTH_V1, AUTH_V2)).toBeGreaterThanOrEqual(0.5);
    expect(lineSimilarity('a();', 'completelyDifferent();')).toBeLessThan(0.5);
  });
});

describe('findDuplicateGroups', () => {
  it('groups files doing the same job and recommends keeping the stronger one', () => {
    const groups = findDuplicateGroups(
      [
        { node: makeNode('src/auth.ts', 400), content: AUTH_V1 },
        { node: makeNode('legacy/auth.ts', 200), content: AUTH_V2 },
        { node: makeNode('src/other.ts'), content: 'export const x = 1;\n' },
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.files.map((f) => f.path).sort()).toEqual(['legacy/auth.ts', 'src/auth.ts']);
    expect(group.recommendedKeep).toBe('src/auth.ts');
    expect(group.recommendedRemove).toEqual(['legacy/auth.ts']);
    const keeper = group.files.find((f) => f.path === 'src/auth.ts')!;
    expect(keeper.pros.length).toBeGreaterThan(0);
    const redundant = group.files.find((f) => f.path === 'legacy/auth.ts')!;
    expect(redundant.cons.length).toBeGreaterThan(0);
  });

  it('returns no groups when every file is unique', () => {
    const groups = findDuplicateGroups(
      [
        { node: makeNode('a.ts'), content: 'export const a = 1;\n' },
        { node: makeNode('b.ts'), content: 'export function b(): void {}\n' },
      ],
      [],
    );
    expect(groups).toHaveLength(0);
  });
});
