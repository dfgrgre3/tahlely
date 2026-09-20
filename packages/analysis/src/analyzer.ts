import type { AnalysisId, AnalyzerKind, FileNode, NewFinding, ProjectId } from '@tahlely/domain';

/**
 * Analyzer contract. Every analyzer — deterministic, compiler-backed, or AI —
 * implements this interface and is registered by kind. The UI never
 * hard-codes analyzers; profiles select them by id.
 */
export interface Analyzer {
  readonly kind: AnalyzerKind;
  readonly rulePrefix: string;
  /** Deterministic analyzers run offline with no model. */
  readonly requiresAi: boolean;
  analyze(context: AnalyzerContext): Promise<AnalyzerResult>;
}

export interface AnalyzerFile {
  node: FileNode;
  /** Text content; undefined for binary/skipped files. */
  content?: string;
}

export interface AnalyzerContext {
  analysisId: AnalysisId;
  projectId: ProjectId;
  projectRoot: string;
  files: AnalyzerFile[];
  signal?: AbortSignal;
  reportProgress?: (completed: number, total: number) => void;
}

export interface AnalyzerResult {
  analyzerId: AnalyzerKind;
  findings: NewFinding[];
  filesScanned: number;
  filesSkipped: number;
  durationMs: number;
}

/** Registry — the extension point for future language/plugin analyzers. */
export class AnalyzerRegistry {
  private readonly analyzers = new Map<AnalyzerKind, Analyzer>();

  register(analyzer: Analyzer): void {
    if (this.analyzers.has(analyzer.kind)) {
      throw new Error(`Analyzer already registered: ${analyzer.kind}`);
    }
    this.analyzers.set(analyzer.kind, analyzer);
  }

  get(kind: AnalyzerKind): Analyzer | undefined {
    return this.analyzers.get(kind);
  }

  list(): Analyzer[] {
    return [...this.analyzers.values()];
  }

  kinds(): AnalyzerKind[] {
    return [...this.analyzers.keys()];
  }
}

export function emptyResult(
  analyzerId: AnalyzerKind,
  filesScanned: number,
  durationMs: number,
): AnalyzerResult {
  return { analyzerId, findings: [], filesScanned, filesSkipped: 0, durationMs };
}
