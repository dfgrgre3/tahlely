import type { EventBus } from '@tahlely/application';
import type { AnalysisRun, AnalyzerKind, Finding, NewFinding } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';
import type { Analyzer, AnalyzerFile } from './analyzer.js';
import { AnalyzerRegistry } from './analyzer.js';
import { applySuppressions } from './suppressions.js';
import type { AnalyzerResult } from './analyzer.js';

export interface EngineCallbacks {
  onProgress?: (completed: number, total: number) => void;
}

export interface EngineOptions {
  /**
   * How many analyzers run concurrently (default 8). Results are always
   * flattened in the run's analyzer order, so output is deterministic
   * regardless of scheduling.
   */
  concurrency?: number;
}

/**
 * Analysis engine: runs the profile's analyzers sequentially (deterministic
 * ordering for stable reports), streams progress, honors cancellation, and
 * materializes NewFindings into persisted Findings. Parallel execution is a
 * Phase-2 optimization behind this same interface.
 */
export class AnalysisEngine {
  private readonly registry = new AnalyzerRegistry();

  constructor(
    private readonly events: EventBus,
    analyzers: Analyzer[] = [],
  ) {
    for (const analyzer of analyzers) this.registry.register(analyzer);
  }

  get analyzers(): AnalyzerRegistry {
    return this.registry;
  }

  async execute(
    run: AnalysisRun,
    files: AnalyzerFile[],
    save: {
      saveRun: (run: AnalysisRun) => Promise<void>;
      saveFindings: (findings: Finding[]) => Promise<void>;
    },
    callbacks: EngineCallbacks = {},
    options: EngineOptions = {},
  ): Promise<{ run: AnalysisRun; findings: Finding[] }> {
    const started = Date.now();
    const active: AnalysisRun = { ...run, status: 'running', startedAt: utcNow() };
    await save.saveRun(active);
    await this.events.emit(
      'AnalysisStarted',
      { analysisId: run.id, projectId: run.projectId },
      run.projectId,
    );

    const requested: AnalyzerKind[] = run.analyzerIds;
    const total = requested.length;
    const results: (AnalyzerResult | undefined)[] = new Array(total);
    let completed = 0;
    // Inline suppressions (tahlely-ignore) are honored at the engine
    // boundary, so they apply to every analyzer without code changes.
    const contentsByPath = new Map(
      files
        .filter((file) => file.content !== undefined)
        .map((file) => [file.node.relativePath, file.content as string]),
    );
    const findings: Finding[] = [];
    try {
      // Analyzers are independent read-only passes — run them concurrently
      // with a bounded worker pool, then flatten in deterministic order.
      const concurrency = Math.max(1, Math.min(options.concurrency ?? total ?? 1, total || 1));
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < total) {
          const index = cursor;
          cursor += 1;
          const kind = requested[index]!;
          const analyzer = this.registry.get(kind);
          if (!analyzer) {
            results[index] = undefined;
            completed += 1;
            callbacks.onProgress?.(completed, total);
            continue;
          }
          const result = await analyzer.analyze({
            analysisId: run.id,
            projectId: run.projectId,
            projectRoot: '',
            files,
            reportProgress: () => {},
          });
          results[index] = result;
          completed += 1;
          callbacks.onProgress?.(completed, total);
          await this.events.emit(
            'AnalysisProgress',
            { analysisId: run.id, projectId: run.projectId, completed, total },
            run.projectId,
          );
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      for (const result of results) {
        if (!result) continue;
        const visible = applySuppressions(result.findings, contentsByPath);
        for (const draft of visible) {
          findings.push(materialize(run, draft));
        }
      }
      const finished: AnalysisRun = {
        ...active,
        status: 'completed',
        endedAt: utcNow(),
        summary: summarize(files.length, findings, Date.now() - started),
        updatedAt: utcNow(),
      };
      await save.saveFindings(findings);
      await save.saveRun(finished);
      await this.events.emit(
        'AnalysisCompleted',
        { analysisId: run.id, projectId: run.projectId, findings: findings.length },
        run.projectId,
      );
      return { run: finished, findings };
    } catch (error) {
      const failed: AnalysisRun = {
        ...active,
        status: 'cancelled',
        endedAt: utcNow(),
        updatedAt: utcNow(),
      };
      if (error instanceof Error && error.name !== 'AbortError') {
        failed.status = 'failed';
        failed.summary = summarize(files.length, findings, Date.now() - started);
      }
      await save.saveRun(failed);
      throw error;
    }
  }
}

function materialize(run: AnalysisRun, draft: NewFinding): Finding {
  const now = utcNow();
  return {
    ...draft,
    id: newId('fnd'),
    projectId: run.projectId,
    analysisId: run.id,
    relatedFiles: draft.relatedFiles ?? [],
    relatedSymbols: draft.relatedSymbols ?? [],
    status: draft.status ?? 'open',
    createdAt: now,
    updatedAt: now,
  };
}

function summarize(
  filesScanned: number,
  findings: Finding[],
  durationMs: number,
): AnalysisRun['summary'] {
  const bySeverity: Record<string, number> = {};
  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }
  return {
    filesScanned,
    filesSkipped: 0,
    findingsCreated: findings.length,
    bySeverity,
    durationMs,
  };
}
