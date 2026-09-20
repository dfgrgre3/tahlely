import type { ProjectScoped, Timestamps } from './common.js';
import type { AnalysisId, ConversationId } from './ids.js';

/** Tool Only | AI Only | Hybrid. Preserved on every analysis run. */
export const ANALYSIS_MODES = ['tool-only', 'ai-only', 'hybrid'] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

export const ANALYSIS_PROFILES = [
  'quick',
  'standard',
  'deep',
  'production',
  'security',
  'architecture',
  'custom',
] as const;
export type AnalysisProfileId = (typeof ANALYSIS_PROFILES)[number];

export const ANALYZER_KINDS = [
  'syntax',
  'imports',
  'duplication',
  'dead-code',
  'security-heuristics',
  'architecture',
  'config',
  'api-contract',
] as const;
export type AnalyzerKind = (typeof ANALYZER_KINDS)[number];

export type AnalysisStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AnalysisProfile {
  id: AnalysisProfileId | string;
  label: string;
  description: string;
  analyzers: AnalyzerKind[];
  mode: AnalysisMode;
  timeoutMs: number;
  maxFiles: number;
  useAi: boolean;
  runExecution: boolean;
  ignoredPaths: string[];
}

export interface AnalysisSummary {
  filesScanned: number;
  filesSkipped: number;
  findingsCreated: number;
  bySeverity: Record<string, number>;
  durationMs: number;
}

export interface AnalysisRun extends ProjectScoped, Timestamps {
  id: AnalysisId;
  conversationId?: ConversationId;
  mode: AnalysisMode;
  profileId: string;
  analyzerIds: AnalyzerKind[];
  targetPaths: string[];
  status: AnalysisStatus;
  startedAt?: string;
  endedAt?: string;
  summary?: AnalysisSummary;
  error?: string;
}
