import type { FileSystemPort } from '@tahlely/application';
import { AppError } from '@tahlely/domain';
import { joinPosix } from '@tahlely/security';

interface MemoryEntry {
  content?: string;
  isDirectory: boolean;
  modifiedAt: string;
}

/**
 * In-memory FileSystemPort for unit tests. Paths are normalized to posix so
 * tests behave identically on every OS.
 */
export class MemoryFileSystem implements FileSystemPort {
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      this.entries.set(normalize(path), {
        content,
        isDirectory: false,
        modifiedAt: new Date(0).toISOString(),
      });
    }
  }

  async readTextFile(path: string): Promise<string> {
    const entry = this.entries.get(normalize(path));
    if (!entry || entry.isDirectory || entry.content === undefined) {
      throw new AppError(`Path not found: ${path}`, {
        kind: 'not-found',
        code: 'FS_NOT_FOUND',
      });
    }
    return entry.content;
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const key = normalize(path);
    const existing = this.entries.get(key);
    if (existing?.isDirectory) {
      throw new AppError(`Cannot write a directory: ${path}`, {
        kind: 'filesystem',
        code: 'FS_IS_DIRECTORY',
      });
    }
    this.entries.set(key, {
      content,
      isDirectory: false,
      modifiedAt: new Date().toISOString(),
    });
  }

  async createFile(path: string, content: string): Promise<void> {
    await this.writeTextFile(path, content);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const from = normalize(oldPath);
    const to = normalize(newPath);
    const entry = this.entries.get(from);
    if (!entry) {
      throw new AppError(`Path not found: ${oldPath}`, {
        kind: 'not-found',
        code: 'FS_NOT_FOUND',
      });
    }
    this.entries.delete(from);
    this.entries.set(to, entry);
  }

  async move(source: string, destination: string): Promise<void> {
    await this.rename(source, destination);
  }

  async deletePath(path: string): Promise<void> {
    const key = normalize(path);
    for (const stored of [...this.entries.keys()]) {
      if (stored === key || stored.startsWith(`${key}/`)) this.entries.delete(stored);
    }
  }

  async stat(path: string): Promise<{ size: number; modifiedAt: string; isDirectory: boolean }> {
    const key = normalize(path);
    const entry = this.entries.get(key);
    if (entry) {
      return {
        size: entry.content?.length ?? 0,
        modifiedAt: entry.modifiedAt,
        isDirectory: entry.isDirectory,
      };
    }
    // Synthesize implicit directories (mirrors real filesystems where readdir
    // implies the parent exists even without an explicit entry).
    if ([...this.entries.keys()].some((stored) => stored.startsWith(`${key}/`))) {
      return { size: 0, modifiedAt: new Date(0).toISOString(), isDirectory: true };
    }
    throw new AppError(`Path not found: ${path}`, {
      kind: 'not-found',
      code: 'FS_NOT_FOUND',
    });
  }

  async listDirectory(path: string): Promise<string[]> {
    const prefix = `${normalize(path)}/`;
    const children = new Set<string>();
    for (const stored of this.entries.keys()) {
      if (!stored.startsWith(prefix)) continue;
      const rest = stored.slice(prefix.length);
      const head = rest.split('/')[0];
      if (head) children.add(`${prefix}${head}`);
    }
    return [...children];
  }

  async exists(path: string): Promise<boolean> {
    const key = normalize(path);
    if (this.entries.has(key)) return true;
    return [...this.entries.keys()].some((stored) => stored.startsWith(`${key}/`));
  }
}

function normalize(path: string): string {
  const joined = joinPosix(path.replace(/\\/g, '/'));
  return joined.startsWith('/') ? joined : `/${joined}`;
}
