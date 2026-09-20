import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@tahlely/application';
import type { ProjectId } from '@tahlely/domain';

describe('EventBus', () => {
  it('delivers typed events to subscribers', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.on('ProjectOpened', (event) => {
      seen.push(event.payload.rootPath);
    });
    await bus.emit(
      'ProjectOpened',
      { projectId: 'prj_1' as ProjectId, rootPath: '/repo' },
      'prj_1' as ProjectId,
    );
    expect(seen).toEqual(['/repo']);
    off();
    await bus.emit(
      'ProjectOpened',
      { projectId: 'prj_1' as ProjectId, rootPath: '/other' },
      'prj_1' as ProjectId,
    );
    expect(seen).toEqual(['/repo']);
  });

  it('supports once() handlers', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('IndexCompleted', handler);
    const payload = { projectId: 'prj_1' as ProjectId, filesIndexed: 3, durationMs: 1 };
    await bus.emit('IndexCompleted', payload, 'prj_1' as ProjectId);
    await bus.emit('IndexCompleted', payload, 'prj_1' as ProjectId);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('isolates handler failures and records them', async () => {
    const bus = new EventBus();
    const ok = vi.fn();
    bus.on('AnalysisStarted', () => {
      throw new Error('subscriber boom');
    });
    bus.on('AnalysisStarted', ok);
    await bus.emit(
      'AnalysisStarted',
      { analysisId: 'anl_1', projectId: 'prj_1' as ProjectId },
      'prj_1' as ProjectId,
    );
    expect(ok).toHaveBeenCalledTimes(1);
    expect(bus.drainErrors()).toHaveLength(1);
    expect(bus.drainErrors()).toHaveLength(0);
  });
});
