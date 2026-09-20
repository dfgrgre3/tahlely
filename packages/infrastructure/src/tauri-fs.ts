import type { FileSystemPort } from '@tahlely/application';

/**
 * Tauri filesystem adapter. Runs in the renderer and delegates to the Rust
 * backend through narrowly-scoped IPC commands (see apps/desktop/src-tauri).
 * The Rust side re-validates the project-root scope, so a compromised
 * renderer still cannot escape the workspace.
 *
 * `invoke` is injected (from @tauri-apps/api/core) to keep this package
 * free of UI-framework and Tauri imports — the desktop app wires it up.
 */
export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export class TauriFileSystem implements FileSystemPort {
  constructor(private readonly invoke: TauriInvoke) {}

  readTextFile(path: string): Promise<string> {
    return this.invoke<string>('fs_read_text', { path });
  }

  writeTextFile(path: string, content: string): Promise<void> {
    return this.invoke<void>('fs_write_text', { path, content });
  }

  createFile(path: string, content: string): Promise<void> {
    return this.invoke<void>('fs_create_file', { path, content });
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    return this.invoke<void>('fs_rename', { oldPath, newPath });
  }

  move(source: string, destination: string): Promise<void> {
    return this.invoke<void>('fs_move', { source, destination });
  }

  deletePath(path: string): Promise<void> {
    return this.invoke<void>('fs_delete', { path });
  }

  stat(path: string): Promise<{ size: number; modifiedAt: string; isDirectory: boolean }> {
    return this.invoke('fs_stat', { path });
  }

  listDirectory(path: string): Promise<string[]> {
    return this.invoke<string[]>('fs_list_dir', { path });
  }

  exists(path: string): Promise<boolean> {
    return this.invoke<boolean>('fs_exists', { path });
  }
}
