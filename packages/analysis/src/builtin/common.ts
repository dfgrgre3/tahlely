import type { NewFinding } from '@tahlely/domain';
import type { AnalyzerContext } from '../analyzer.js';

/** Draft helper: analyzers describe findings; the engine stamps ids. */
export function draft(
  ctx: AnalyzerContext,
  partial: Omit<NewFinding, 'projectId' | 'analysisId'>,
): NewFinding {
  return { ...partial, projectId: ctx.projectId, analysisId: ctx.analysisId };
}

export function throwIfAborted(ctx: AnalyzerContext): void {
  ctx.signal?.throwIfAborted();
}

/** Text lines for analyzers; undefined when the file has no readable text. */
export function textLines(content: string | undefined): string[] | undefined {
  if (content === undefined) return undefined;
  return content.split('\n');
}
