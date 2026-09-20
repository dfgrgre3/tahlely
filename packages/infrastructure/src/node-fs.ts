import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import type { FileSystemPort } from '@tahlely/application';
import { AppError } from '@tahlely/domain';

/**
 * Node.js filesystem adapter (used by tests, CLI tooling, and as the
 * reference implementation of FileSystemPort). The Tauri adapter exposes the
 * same port inside the desktop sandbox — callers never import this directly.
 */
export class NodeFileSystem implements FileSystemPort {
  async readTextFile(path: string): Promise<string> {
    try {
      return await fs.readFile(path, 'utf8');
    } catch (error) {
      throw toFsError('read', path, error);
    }
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    try {
      await fs.mkdir(nodePath.dirname(path), { recursive: true });
      await fs.writeFile(path, content, 'utf8');
    } catch (error) {
      throw toFsError('write', path, error);
    }
  }

  async createFile(path: string, content: string): Promise<void> {
    try {
      await fs.mkdir(nodePath.dirname(path), { recursive: true });
      await fs.writeFile(path, content, 'utf8');
    } catch (error) {
      throw toFsError('create', path, error);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    try {
      await fs.rename(oldPath, newPath);
    } catch (error) {
      throw toFsError('rename', oldPath, error);
    }
  }

  async move(source: string, destination: string): Promise<void> {
    try {
      await fs.mkdir(nodePath.dirname(destination), { recursive: true });
      await fs.rename(source, destination);
    } catch (error) {
      throw toFsError('move', source, error);
    }
  }

  async deletePath(path: string): Promise<void> {
    try {
      await fs.rm(path, { recursive: true, force: true });
    } catch (error) {
      throw toFsError('delete', path, error);
    }
  }

  async stat(path: string): Promise<{ size: number; modifiedAt: string; isDirectory: boolean }> {
    try {
      const info = await fs.stat(path);
      return {
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        isDirectory: info.isDirectory(),
      };
    } catch (error) {
      throw toFsError('stat', path, error);
    }
  }

  async listDirectory(path: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(path);
      return entries.map((entry) => nodePath.join(path, entry));
    } catch (error) {
      throw toFsError('list', path, error);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

function toFsError(op: string, path: string, cause: unknown): AppError {
  const code = (cause as { code?: string } | null)?.code;
  if (code === 'ENOENT') {
    return new AppError(`Path not found: ${path}`, {
      kind: 'not-found',
      code: 'FS_NOT_FOUND',
      details: { op },
    });
  }
  return new AppError(`Filesystem ${op} failed for ${path}.`, {
    kind: 'filesystem',
    code: 'FS_IO_ERROR',
    details: { op, systemCode: code },
    cause,
  });
}
