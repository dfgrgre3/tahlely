import type { AnalysisMode, AnalysisProfile, AnalyzerKind } from '@tahlely/domain';

/**
 * Extensible analysis profiles. Each profile declares analyzers, depth,
 * timeout, AI usage, and ignored paths — custom profiles reuse the same
 * shape (stable contract for Phase 2 UI + API).
 */
export const ANALYSIS_PROFILES: Record<string, AnalysisProfile> = {
  quick: {
    id: 'quick',
    label: 'Quick Scan',
    description: 'Fast syntax and import surface check. No AI, no execution.',
    analyzers: ['syntax', 'imports'],
    mode: 'tool-only',
    timeoutMs: 30000,
    maxFiles: 2000,
    useAi: false,
    runExecution: false,
    ignoredPaths: [],
  },
  standard: {
    id: 'standard',
    label: 'Standard Analysis',
    description: 'Structure, imports, duplication, dead code, and security heuristics.',
    analyzers: ['syntax', 'imports', 'duplication', 'dead-code', 'security-heuristics'],
    mode: 'tool-only',
    timeoutMs: 120000,
    maxFiles: 20000,
    useAi: false,
    runExecution: false,
    ignoredPaths: [],
  },
  deep: {
    id: 'deep',
    label: 'Deep Analysis',
    description: 'Standard analysis plus architecture and AI reasoning (hybrid).',
    analyzers: [
      'syntax',
      'imports',
      'duplication',
      'dead-code',
      'security-heuristics',
      'architecture',
    ],
    mode: 'hybrid',
    timeoutMs: 600000,
    maxFiles: 100000,
    useAi: true,
    runExecution: false,
    ignoredPaths: [],
  },
  production: {
    id: 'production',
    label: 'Production Audit',
    description: 'Deep analysis plus config, contracts, and runtime validation.',
    analyzers: [
      'syntax',
      'imports',
      'duplication',
      'dead-code',
      'security-heuristics',
      'architecture',
      'config',
      'api-contract',
    ],
    mode: 'hybrid',
    timeoutMs: 1800000,
    maxFiles: 200000,
    useAi: true,
    runExecution: true,
    ignoredPaths: [],
  },
  security: {
    id: 'security',
    label: 'Security Audit',
    description: 'Focused security-heuristic pass with AI-assisted triage.',
    analyzers: ['security-heuristics', 'imports', 'config'],
    mode: 'hybrid',
    timeoutMs: 600000,
    maxFiles: 100000,
    useAi: true,
    runExecution: false,
    ignoredPaths: [],
  },
  architecture: {
    id: 'architecture',
    label: 'Architecture Audit',
    description: 'Dependency graph, layering, cycles, and dead code.',
    analyzers: ['architecture', 'imports', 'duplication', 'dead-code'],
    mode: 'tool-only',
    timeoutMs: 600000,
    maxFiles: 100000,
    useAi: false,
    runExecution: false,
    ignoredPaths: [],
  },
};

export function getProfile(id: string): AnalysisProfile {
  return ANALYSIS_PROFILES[id] ?? customProfile(id, []);
}

export function customProfile(
  id: string,
  analyzers: AnalyzerKind[],
  overrides?: Partial<AnalysisProfile>,
): AnalysisProfile {
  return {
    id,
    label: overrides?.label ?? 'Custom',
    description: overrides?.description ?? 'User-defined analyzer selection.',
    analyzers,
    mode: 'tool-only',
    timeoutMs: 120000,
    maxFiles: 20000,
    useAi: false,
    runExecution: false,
    ignoredPaths: [],
    ...overrides,
  };
}

/** Profiles in UI display order. */
export function listProfiles(): AnalysisProfile[] {
  return ['quick', 'standard', 'deep', 'production', 'security', 'architecture'].map(
    (id) => ANALYSIS_PROFILES[id] as AnalysisProfile,
  );
}

export const ANALYSIS_MODES: AnalysisMode[] = ['tool-only', 'ai-only', 'hybrid'];
