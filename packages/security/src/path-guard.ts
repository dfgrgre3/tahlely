import { AppError } from '@tahlely/domain';

/**
 * Path guard — the filesystem security boundary. Every path that crosses the
 * application → filesystem boundary is normalized and validated here:
 * traversal (`..`), absolute escapes, null bytes, and (where the platform
 * adapter can detect them) symlinks pointing outside the project root.
 */
export function normalizePosix(input: string): string {
  return input.replace(/\\/g, '/');
}

export function joinPosix(...parts: string[]): string {
  const joined = parts.join('/').replace(/\/+/g, '/');
  const segments: string[] = [];
  for (const segment of joined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const leadingSlash = joined.startsWith('/') ? '/' : '';
  return `${leadingSlash}${segments.join('/')}`;
}

export function isAbsolutePosix(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
}

export interface ResolvedPath {
  /** Absolute normalized path safe to hand to the OS adapter. */
  absolute: string;
  /** Posix-style path relative to the project root. */
  relative: string;
}

/**
 * Resolve a user/agent-supplied path against the project root.
 * Throws a security-violation AppError on traversal or escape attempts.
 */
export function resolveInsideRoot(root: string, candidate: string): ResolvedPath {
  if (candidate.includes('\0')) {
    throw new AppError('Path contains a null byte.', {
      kind: 'security-violation',
      code: 'PATH_NULL_BYTE',
    });
  }
  const rootNorm = normalizePosix(root).replace(/\/+$/, '');
  const candNorm = normalizePosix(candidate);
  const absolute = isAbsolutePosix(candNorm) ? joinPosix(candNorm) : joinPosix(rootNorm, candNorm);
  const rootWithSlash = rootNorm.endsWith('/') ? rootNorm : `${rootNorm}/`;
  if (absolute !== rootNorm && !absolute.startsWith(rootWithSlash)) {
    throw new AppError(`Path escapes the project root: ${candidate}`, {
      kind: 'security-violation',
      code: 'PATH_TRAVERSAL',
      details: { root: rootNorm },
    });
  }
  const relative = absolute === rootNorm ? '' : absolute.slice(rootWithSlash.length);
  return { absolute, relative };
}

/** Dangerous shell metacharacters — execution layer rejects unlisted commands. */
const SHELL_METACHARACTERS = /[;&|`$(){}[\]!#~*?<>\n\r]/;

export function assertSafeArg(arg: string): void {
  if (arg.length === 0 || arg.length > 4096) {
    throw new AppError('Invalid command argument length.', {
      kind: 'validation',
      code: 'EXEC_BAD_ARG',
    });
  }
  if (arg.includes('\0')) {
    throw new AppError('Command argument contains a null byte.', {
      kind: 'security-violation',
      code: 'EXEC_NULL_BYTE',
    });
  }
}

export function assertNoShellMetachars(command: string): void {
  if (SHELL_METACHARACTERS.test(command)) {
    throw new AppError('Shell metacharacters are not allowed; commands run without a shell.', {
      kind: 'security-violation',
      code: 'EXEC_SHELL_METACHAR',
    });
  }
}
