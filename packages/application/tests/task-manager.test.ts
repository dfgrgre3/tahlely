import { describe, expect, it } from 'vitest';
import { TaskManager } from '@tahlely/application';

describe('TaskManager', () => {
  it('runs a task to completion with progress', async () => {
    const manager = new TaskManager();
    const progress: number[] = [];
    const task = manager.create({
      type: 'indexing',
      title: 'scan',
      callbacks: { onProgress: (t) => progress.push(t.progress) },
    });
    expect(task.status).toBe('queued');
    const final = await manager.run(task.id, async (ctx) => {
      ctx.reportProgress(0.5);
      ctx.throwIfCancelled();
      return 'done-result';
    });
    expect(final.status).toBe('completed');
    expect(final.result).toBe('done-result');
    expect(progress).toContain(0.5);
  });

  it('marks failures with the error message', async () => {
    const manager = new TaskManager();
    const task = manager.create({ type: 'analysis', title: 'fail' });
    const final = await manager.run(task.id, async () => {
      throw new Error('analyzer exploded');
    });
    expect(final.status).toBe('failed');
    expect(final.error).toBe('analyzer exploded');
  });

  it('honours cooperative cancellation', async () => {
    const manager = new TaskManager();
    const task = manager.create({ type: 'analysis', title: 'cancel-me' });
    const pending = manager.run(task.id, async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      ctx.throwIfCancelled();
    });
    manager.requestCancel(task.id);
    const final = await pending;
    expect(final.status).toBe('cancelled');
    expect(manager.get(task.id).cancelRequested).toBe(true);
  });

  it('supports pause and resume', () => {
    const manager = new TaskManager();
    const task = manager.create({ type: 'report', title: 'pausable' });
    void manager.run(task.id, async () => 'x');
    expect(manager.pause(task.id).status).toBe('paused');
    expect(manager.resume(task.id).status).toBe('running');
    expect(manager.list()).toHaveLength(1);
  });
});
