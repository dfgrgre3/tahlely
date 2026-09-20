import type { ProjectId, TaskId, TaskRecord, TaskStatus, TaskType } from '@tahlely/domain';
import { AppError, isCancellation, newId, utcNow } from '@tahlely/domain';
import type { Clock } from './ports.js';
import { systemClock } from './ports.js';

export interface TaskCallbacks {
  onProgress?: (task: TaskRecord) => void;
  onStatus?: (task: TaskRecord) => void;
}

interface ManagedTask extends TaskCallbacks {
  record: TaskRecord;
  aborter: AbortController;
  worker?: Promise<unknown>;
}

/**
 * Background task abstraction: queued → running → completed|failed|cancelled
 * (+ paused). Cooperative cancellation via AbortSignal; the UI never blocks
 * because task bodies run detached from the render loop.
 */
export class TaskManager {
  private readonly tasks = new Map<TaskId, ManagedTask>();
  private readonly clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.clock = clock;
  }

  create(input: {
    type: TaskType;
    title: string;
    projectId?: ProjectId;
    priority?: number;
    cancellable?: boolean;
    callbacks?: TaskCallbacks;
  }): TaskRecord {
    const now = this.clock.now();
    const record: TaskRecord = {
      id: newId('task'),
      type: input.type,
      title: input.title,
      projectId: input.projectId,
      status: 'queued',
      progress: 0,
      priority: input.priority ?? 0,
      cancellable: input.cancellable ?? true,
      cancelRequested: false,
      createdAt: now,
    };
    this.tasks.set(record.id, {
      record,
      aborter: new AbortController(),
      onProgress: input.callbacks?.onProgress,
      onStatus: input.callbacks?.onStatus,
    });
    return this.snapshot(record.id);
  }

  /**
   * Runs the body detached from the caller. Resolves with the final record.
   * Cancellation requested via requestCancel() aborts the signal AND marks
   * the record cancelled even if the body ignores the signal.
   */
  run<T>(id: TaskId, body: (ctx: TaskContext) => Promise<T>): Promise<TaskRecord> {
    const managed = this.require(id);
    const record = managed.record;
    if (record.status !== 'queued') {
      throw new AppError(`Task ${id} cannot run from status ${record.status}.`, {
        kind: 'validation',
        code: 'TASK_BAD_STATE',
      });
    }
    this.transition(record, 'running', { startedAt: this.clock.now() });
    const ctx: TaskContext = {
      signal: managed.aborter.signal,
      isCancellationRequested: () => record.cancelRequested,
      throwIfCancelled: () => {
        if (record.cancelRequested || managed.aborter.signal.aborted) {
          throw new AppError('Task was cancelled.', {
            kind: 'cancellation',
            code: 'TASK_CANCELLED',
          });
        }
      },
      reportProgress: (progress: number) => {
        record.progress = Math.min(1, Math.max(0, progress));
        managed.onProgress?.({ ...record });
      },
    };
    const worker = (async () => {
      try {
        const result = await body(ctx);
        if (record.cancelRequested) {
          this.transition(record, 'cancelled', { endedAt: this.clock.now() });
        } else {
          record.result = result;
          record.progress = 1;
          this.transition(record, 'completed', { endedAt: this.clock.now() });
        }
      } catch (error) {
        if (isCancellation(error) || record.cancelRequested) {
          this.transition(record, 'cancelled', { endedAt: this.clock.now() });
        } else {
          record.error = error instanceof Error ? error.message : String(error);
          this.transition(record, 'failed', { endedAt: this.clock.now() });
        }
      }
      return { ...record };
    })();
    managed.worker = worker;
    return worker;
  }

  requestCancel(id: TaskId): TaskRecord {
    const managed = this.require(id);
    const { record } = managed;
    if (!managed.record.cancellable) {
      throw new AppError(`Task ${id} is not cancellable.`, {
        kind: 'permission',
        code: 'TASK_NOT_CANCELLABLE',
      });
    }
    record.cancelRequested = true;
    managed.aborter.abort();
    return this.snapshot(id);
  }

  pause(id: TaskId): TaskRecord {
    const managed = this.require(id);
    if (managed.record.status !== 'running') {
      throw new AppError('Only running tasks can be paused.', {
        kind: 'validation',
        code: 'TASK_BAD_STATE',
      });
    }
    this.transition(managed.record, 'paused');
    return this.snapshot(id);
  }

  resume(id: TaskId): TaskRecord {
    const managed = this.require(id);
    if (managed.record.status !== 'paused') {
      throw new AppError('Only paused tasks can be resumed.', {
        kind: 'validation',
        code: 'TASK_BAD_STATE',
      });
    }
    this.transition(managed.record, 'running');
    return this.snapshot(id);
  }

  get(id: TaskId): TaskRecord {
    return this.snapshot(id);
  }

  list(projectId?: ProjectId): TaskRecord[] {
    return [...this.tasks.values()]
      .map((m) => ({ ...m.record }))
      .filter((r) => !projectId || r.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private require(id: TaskId): ManagedTask {
    const managed = this.tasks.get(id);
    if (!managed) {
      throw new AppError(`Task ${id} not found.`, { kind: 'not-found', code: 'TASK_MISSING' });
    }
    return managed;
  }

  private snapshot(id: TaskId): TaskRecord {
    return { ...this.require(id).record };
  }

  private transition(record: TaskRecord, status: TaskStatus, extra?: Partial<TaskRecord>): void {
    Object.assign(record, extra, { status });
    const managed = this.tasks.get(record.id);
    managed?.onStatus?.({ ...record });
  }
}

export interface TaskContext {
  readonly signal: AbortSignal;
  isCancellationRequested(): boolean;
  throwIfCancelled(): void;
  reportProgress(progress: number): void;
}

/** Helper for tests and scripts: run a body with progress callbacks. */
export async function runInlineTask<T>(body: (ctx: TaskContext) => Promise<T>): Promise<T> {
  const manager = new TaskManager();
  const task = manager.create({ type: 'import', title: 'inline' });
  const final = await manager.run(task.id, body);
  if (final.status === 'failed') throw new Error(final.error ?? 'Task failed');
  return final.result as T;
}

export function taskAgeMs(task: TaskRecord, now: string = utcNow()): number {
  return Date.parse(now) - Date.parse(task.createdAt);
}
