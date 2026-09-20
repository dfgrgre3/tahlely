import type { Confidence, FindingSource, ProjectScoped, Severity, Timestamps } from './common.js';
import type { AnalysisId, FileId, FindingId } from './ids.js';

export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'suppressed';

export const FINDING_CATEGORIES = [
  'security',
  'correctness',
  'performance',
  'architecture',
  'dependencies',
  'integration',
  'api-contract',
  'database',
  'duplication',
  'dead-code',
  'style',
  'configuration',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/**
 * Traceability unit. An AI claim is stored as `ai-reasoning` evidence and must
 * not be presented with the weight of compiler/static evidence.
 */
export interface Evidence {
  kind:
    | 'code-excerpt'
    | 'analyzer'
    | 'compiler'
    | 'linter'
    | 'runtime'
    | 'dependency'
    | 'ai-reasoning'
    | 'user';
  summary: string;
  /** Stable reference: file path + line range, symbol id, rule id, ... */
  ref?: string;
  analyzerId?: string;
  confidence: Confidence;
}

export interface Finding extends ProjectScoped, Timestamps {
  id: FindingId;
  analysisId: AnalysisId;
  fileId?: FileId;
  path?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  category: FindingCategory;
  ruleId: string;
  title: string;
  description: string;
  impact?: string;
  severity: Severity;
  confidence: Confidence;
  source: FindingSource;
  evidence: Evidence[];
  recommendation?: string;
  suggestedFix?: string;
  relatedFiles: string[];
  relatedSymbols: string[];
  status: FindingStatus;
}

export type NewFinding = Omit<Finding, 'id' | 'createdAt' | 'updatedAt' | 'status'> &
  Partial<Pick<Finding, 'status'>>;
