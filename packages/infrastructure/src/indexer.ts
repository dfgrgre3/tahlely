import type { FileSystemPort } from '@tahlely/application';
import type { FileNode, ProjectId } from '@tahlely/domain';
import { hashString, newId } from '@tahlely/domain';
import { extensionOf, languageForExtension } from './project-discovery.js';
import {
  IgnoreMatcher,
  builtinIgnoreRules,
  isProbablyBinary,
  isProbablyGenerated,
} from './ignore-rules.js';

export interface IndexOptions {
  maxFiles: number;
  maxFileSizeBytes: number;
  extraIgnores: string[];
  respectGitignore: boolean;
  followSymlinks?: boolean;
  onProgress?: (scanned: number) => void;
  signal?: AbortSignal;
}

export interface IndexOutcome {
  files: FileNode[];
  scanned: number;
  skippedIgnored: number;
  skippedTooLarge: number;
  truncated: boolean;
}

const DIR_CONCURRENCY = 8;

/**
 * Incremental-ready file indexer. Walks the project tree WITHOUT loading file
 * contents (metadata only: size, mtime, hashes computed lazily by analyzers),
 * so even very large repositories scan without freezing the UI. Content
 * hashing happens per-file on demand and is cached by the ContentCache.
 */
export async function indexProject(
  fs: FileSystemPort,
  projectId: ProjectId,
  rootPath: string,
  options: IndexOptions,
): Promise<IndexOutcome> {
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const matcher = new IgnoreMatcher([
    ...builtinIgnoreRules().map((rule) => rule.pattern),
    ...options.extraIgnores,
  ]);
  const outcome: IndexOutcome = {
    files: [],
    scanned: 0,
    skippedIgnored: 0,
    skippedTooLarge: 0,
    truncated: false,
  };

  let gitignore: IgnoreMatcher | undefined;
  if (options.respectGitignore) {
    try {
      const raw = await fs.readTextFile(`${root}/.gitignore`);
      gitignore = new IgnoreMatcher(
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      );
    } catch {
      gitignore = undefined;
    }
  }

  const queue: string[] = [root];
  const active = new Set<Promise<void>>();

  const visitFile = async (absolute: string): Promise<void> => {
    const relative = absolute.slice(root.length + 1);
    if (matcher.isIgnored(relative) || gitignore?.isIgnored(relative)) {
      outcome.skippedIgnored += 1;
      return;
    }
    let size = 0;
    let modifiedAt: string | undefined;
    try {
      const info = await fs.stat(absolute);
      if (info.isDirectory) return;
      size = info.size;
      modifiedAt = info.modifiedAt;
    } catch {
      return;
    }
    if (size > options.maxFileSizeBytes) {
      outcome.skippedTooLarge += 1;
      return;
    }
    const name = absolute.split('/').pop() ?? absolute;
    const extension = extensionOf(name);
    outcome.files.push({
      id: newId('file'),
      projectId,
      path: absolute,
      relativePath: relative,
      name,
      extension,
      language: languageForExtension(extension),
      size,
      modifiedAt,
      ignored: false,
      generated: isProbablyGenerated(relative),
      binary: isProbablyBinary(extension),
      analyzed: false,
      importance: importanceOf(relative),
      risk: 0,
    });
    outcome.scanned += 1;
    options.onProgress?.(outcome.scanned);
    if (outcome.files.length >= options.maxFiles) outcome.truncated = true;
  };

  const visitDir = async (dir: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await fs.listDirectory(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      if (outcome.truncated) return;
      const normalized = entry.replace(/\\/g, '/');
      const relative = normalized.slice(root.length + 1);
      const lastSegment = normalized.split('/').pop() ?? '';
      if (matcher.isIgnored(relative) || matcher.isIgnored(lastSegment)) {
        outcome.skippedIgnored += 1;
        continue;
      }
      let isDirectory = false;
      try {
        isDirectory = (await fs.stat(normalized)).isDirectory;
      } catch {
        continue;
      }
      if (isDirectory) {
        queue.push(normalized);
      } else {
        const task = visitFile(normalized);
        active.add(task);
        void task.then(() => active.delete(task));
        if (active.size >= DIR_CONCURRENCY) await Promise.race(active);
      }
    }
  };

  while (queue.length > 0) {
    options.signal?.throwIfAborted();
    if (outcome.truncated) break;
    const dir = queue.shift();
    if (dir) await visitDir(dir);
  }
  await Promise.all([...active]);
  outcome.files.sort(
    (a, b) => b.importance - a.importance || a.relativePath.localeCompare(b.relativePath),
  );
  return outcome;
}

/** Cheap static importance: entry points and sources rank above assets. */
function importanceOf(relativePath: string): number {
  const lower = relativePath.toLowerCase();
  if (/(^|\/)main\.(ts|tsx|js|jsx|py|rs|go)$/.test(lower)) return 100;
  if (/^src\//.test(lower)) return 70;
  if (/\.(ts|tsx|js|jsx|py|rs|go|java|cs)$/.test(lower)) return 50;
  if (/readme|changelog|license/i.test(lower)) return 20;
  if (/\.(png|jpg|ico|woff2?|ttf)$/.test(lower)) return 5;
  return 10;
}

/** Content hash for change detection (non-crypto, platform-free). */
export function hashContent(content: string | Uint8Array): string {
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  return hashString(text);
}
