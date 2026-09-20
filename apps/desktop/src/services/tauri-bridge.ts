import { invoke } from '@tauri-apps/api/core';

/** True when running inside the Tauri webview (vs. plain browser dev). */
export function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  } catch {
    return false;
  }
}

export function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

/** Best-effort shell ping; null when not inside Tauri. */
export async function shellPing(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await tauriInvoke<string>('app_ping');
  } catch {
    return null;
  }
}
