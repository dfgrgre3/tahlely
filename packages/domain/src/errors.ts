/** Machine-readable error taxonomy shared by every layer. */
export type ErrorKind =
  | 'filesystem'
  | 'validation'
  | 'parsing'
  | 'analyzer'
  | 'database'
  | 'ai-provider'
  | 'model'
  | 'permission'
  | 'execution'
  | 'timeout'
  | 'cancellation'
  | 'conflict'
  | 'security-violation'
  | 'not-found'
  | 'unknown';

export interface AppErrorInit {
  kind: ErrorKind;
  /** Stable machine-readable code, e.g. "FS_PATH_TRAVERSAL". */
  code?: string;
  /** Safe structured details (must never contain secrets). */
  details?: Record<string, unknown>;
  cause?: unknown;
}

const KIND_TO_DEFAULT_MESSAGE: Record<ErrorKind, string> = {
  filesystem: 'A filesystem operation failed.',
  validation: 'Invalid input.',
  parsing: 'Could not parse the file.',
  analyzer: 'An analyzer failed.',
  database: 'A storage operation failed.',
  'ai-provider': 'The AI provider request failed.',
  model: 'The model request failed.',
  permission: 'Permission denied.',
  execution: 'Command execution failed.',
  timeout: 'The operation timed out.',
  cancellation: 'The operation was cancelled.',
  conflict: 'Version conflict detected.',
  'security-violation': 'Blocked by the security policy.',
  'not-found': 'Not found.',
  unknown: 'An unexpected error occurred.',
};

/** Base error for the whole platform. Always machine- AND user-readable. */
export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string | undefined, init: AppErrorInit) {
    super(message ?? KIND_TO_DEFAULT_MESSAGE[init.kind]);
    this.name = this.constructor.name;
    this.kind = init.kind;
    this.code = init.code;
    this.details = init.details;
    if (init.cause !== undefined) {
      (this as { cause?: unknown }).cause = init.cause;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      code: this.code,
      message: this.message,
      details: this.details ?? {},
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Cancellation is control flow, not failure — callers use this to branch. */
export class CancellationError extends AppError {
  constructor(message = 'Operation was cancelled.') {
    super(message, { kind: 'cancellation', code: 'TASK_CANCELLED' });
  }
}

export function isCancellation(error: unknown): boolean {
  return (
    error instanceof CancellationError ||
    (isAppError(error) && error.kind === 'cancellation') ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

/** Safe one-line message for UI surfaces (never includes secrets by construction). */
export function userMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}
