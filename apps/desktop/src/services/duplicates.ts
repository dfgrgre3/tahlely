import type { FileNode, Finding } from '@tahlely/domain';
import { newId } from '@tahlely/domain';

export interface DuplicateFileInfo {
  /** Project-relative path. */
  path: string;
  size: number;
  lines: number;
  findings: number;
  exports: number;
  score: number;
  pros: string[];
  cons: string[];
}

export interface DuplicateGroup {
  id: string;
  /** Why these files were grouped (identical logic / same role). */
  reason: string;
  files: DuplicateFileInfo[];
  recommendedKeep: string;
  recommendedRemove: string[];
}

interface IndexedContent {
  node: FileNode;
  content: string;
}

/** Strip comments + whitespace so functionally identical files hash equal. */
export function normalizeContent(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineSet(content: string): Set<string> {
  return new Set(
    normalizeContent(content)
      .split(/[;{}\n]/)
      .map((line) => line.trim())
      .filter((line) => line.length > 3),
  );
}

/** Jaccard similarity between two files' normalized line sets. */
export function lineSimilarity(a: string, b: string): number {
  const setA = lineSet(a);
  const setB = lineSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const line of setA) if (setB.has(line)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

function countExports(content: string): number {
  return (content.match(/\bexport\b/g) ?? []).length;
}

function scoreOf(lines: number, exports: number, findings: number): number {
  return exports * 5 + Math.min(lines, 500) * 0.2 - findings * 10;
}

function prosCons(
  info: Omit<DuplicateFileInfo, 'pros' | 'cons'>,
  best: Omit<DuplicateFileInfo, 'pros' | 'cons'>,
): { pros: string[]; cons: string[] } {
  const pros: string[] = [];
  const cons: string[] = [];
  if (info.path === best.path) {
    pros.push('Highest overall value score in the group');
  }
  if (info.exports >= best.exports && info.exports > 0) pros.push(`${info.exports} exports`);
  else cons.push(`Fewer exports (${info.exports} vs ${best.exports})`);
  if (info.findings <= best.findings) pros.push(`${info.findings} open findings`);
  else cons.push(`More issues (${info.findings} vs ${best.findings} findings)`);
  if (info.lines >= best.lines) pros.push(`Most complete implementation (${info.lines} lines)`);
  else cons.push(`Less complete (${info.lines} vs ${best.lines} lines)`);
  return { pros, cons };
}

/**
 * Detect files that do the same job: identical normalized content OR same
 * file name with ≥50% line overlap. For each group the tool recommends which
 * file to keep (highest value score) and lists pros/cons for every file.
 */
export function findDuplicateGroups(
  files: IndexedContent[],
  findings: Finding[],
): DuplicateGroup[] {
  const findingsByPath = new Map<string, number>();
  for (const finding of findings) {
    if (finding.path) {
      findingsByPath.set(finding.path, (findingsByPath.get(finding.path) ?? 0) + 1);
    }
  }
  const candidates = files.filter(
    (f) => !f.node.binary && !f.node.generated && f.content.trim().length > 0,
  );

  const pairs: [string, string, string][] = [];
  const byHash = new Map<string, IndexedContent[]>();
  for (const file of candidates) {
    const hash = normalizeContent(file.content);
    const bucket = byHash.get(hash) ?? [];
    bucket.push(file);
    byHash.set(hash, bucket);
  }
  for (const bucket of byHash.values()) {
    for (let i = 1; i < bucket.length; i += 1) {
      pairs.push([
        bucket[0]!.node.relativePath,
        bucket[i]!.node.relativePath,
        'identical logic (same normalized content)',
      ]);
    }
  }
  const byName = new Map<string, IndexedContent[]>();
  for (const file of candidates) {
    const bucket = byName.get(file.node.name) ?? [];
    bucket.push(file);
    byName.set(file.node.name, bucket);
  }
  for (const bucket of byName.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        if (a.node.relativePath === b.node.relativePath) continue;
        if (lineSimilarity(a.content, b.content) >= 0.5) {
          pairs.push([
            a.node.relativePath,
            b.node.relativePath,
            `same role (both named ${a.node.name}, ≥50% shared logic)`,
          ]);
        }
      }
    }
  }

  // Union-find to merge pairs into groups.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const root = parent.get(x) ?? x;
    if (root !== x) parent.set(x, find(root));
    return parent.get(x) ?? x;
  };
  const reasonByRoot = new Map<string, string>();
  for (const [a, b, reason] of pairs) {
    const ra = find(a);
    const rb = find(b);
    parent.set(ra, rb);
    reasonByRoot.set(find(a), reasonByRoot.get(ra) ?? reason);
  }
  const grouped = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    const root = find(a);
    const set = grouped.get(root) ?? new Set<string>();
    set.add(a);
    set.add(b);
    grouped.set(root, set);
  }

  const byPath = new Map(candidates.map((f) => [f.node.relativePath, f]));
  const groups: DuplicateGroup[] = [];
  for (const [root, paths] of grouped) {
    const base = [...paths].map((path) => {
      const file = byPath.get(path)!;
      const lines = file.content.split('\n').length;
      const exports = countExports(file.content);
      const count = findingsByPath.get(path) ?? 0;
      return {
        path,
        size: file.node.size,
        lines,
        findings: count,
        exports,
        score: scoreOf(lines, exports, count),
      };
    });
    const best = [...base].sort((a, b) => b.score - a.score)[0]!;
    const files: DuplicateFileInfo[] = base.map((info) => ({
      ...info,
      ...prosCons(info, best),
    }));
    groups.push({
      id: newId('dup'),
      reason: reasonByRoot.get(root) ?? 'similar implementation',
      files: files.sort((a, b) => b.score - a.score),
      recommendedKeep: best.path,
      recommendedRemove: base.filter((f) => f.path !== best.path).map((f) => f.path),
    });
  }
  return groups.sort((a, b) => b.files.length - a.files.length);
}
