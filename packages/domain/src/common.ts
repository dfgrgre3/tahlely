import type { ProjectId } from './ids.js';

/** Severity scale shared by findings, problems panel, and reports. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** How much the finding source should be trusted. */
export const CONFIDENCES = ['verified', 'high', 'medium', 'low', 'speculative'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/**
 * Where a finding came from. AI claims are NEVER equal to compiler/static
 * findings — the source is preserved so reports can weight them differently.
 */
export const FINDING_SOURCES = [
  'analyzer',
  'compiler',
  'linter',
  'runtime',
  'ai',
  'user',
  'combined',
] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

/** 1-based source location. */
export interface SourceLocation {
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export function utcNow(): string {
  return new Date().toISOString();
}

/** Scoping helper: every project-owned record carries its project id. */
export interface ProjectScoped {
  projectId: ProjectId;
}
