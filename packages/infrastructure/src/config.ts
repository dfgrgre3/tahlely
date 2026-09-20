/**
 * Typed configuration. Supports user-level defaults merged over built-in
 * defaults, with optional project-level overrides. Validation is explicit
 * (no silent coercion) and secrets are never serialized by describe().
 */
export interface AiProviderConfig {
  id: string;
  kind: string;
  baseUrl?: string;
  defaultModel?: string;
  /** Secret handle / env reference — the raw key is NEVER stored here. */
  credentialRef?: string;
  timeoutMs: number;
}

export interface AnalysisConfig {
  defaultProfile: string;
  maxFilesPerRun: number;
  defaultTimeoutMs: number;
  respectGitignore: boolean;
  extraIgnores: string[];
}

export interface IndexingConfig {
  enabled: boolean;
  maxFileSizeBytes: number;
  maxFiles: number;
  debounceMs: number;
  followSymlinks: boolean;
}

export interface ExecutionConfig {
  enabled: boolean;
  defaultTimeoutMs: number;
  maxOutputBytes: number;
  allowlistExtra: string[];
}

export interface SecurityConfig {
  emergencyStop: boolean;
  defaultPolicy: 'allow' | 'require-approval' | 'deny';
  auditRetentionDays: number;
}

export interface AppConfig {
  version: 1;
  dataDir: string;
  ai: { providers: AiProviderConfig[]; defaultProviderId?: string };
  analysis: AnalysisConfig;
  indexing: IndexingConfig;
  execution: ExecutionConfig;
  security: SecurityConfig;
}

export function defaultConfig(dataDir: string): AppConfig {
  return {
    version: 1,
    dataDir,
    ai: { providers: [] },
    analysis: {
      defaultProfile: 'standard',
      maxFilesPerRun: 20000,
      defaultTimeoutMs: 120000,
      respectGitignore: true,
      extraIgnores: [],
    },
    indexing: {
      enabled: true,
      maxFileSizeBytes: 2 * 1024 * 1024,
      maxFiles: 200000,
      debounceMs: 500,
      followSymlinks: false,
    },
    execution: {
      enabled: true,
      defaultTimeoutMs: 120000,
      maxOutputBytes: 1024 * 1024,
      allowlistExtra: [],
    },
    security: {
      emergencyStop: false,
      defaultPolicy: 'require-approval',
      auditRetentionDays: 365,
    },
  };
}

export interface ConfigOverrides {
  dataDir?: string;
  ai?: { providers?: AiProviderConfig[]; defaultProviderId?: string };
  analysis?: Partial<AnalysisConfig>;
  indexing?: Partial<IndexingConfig>;
  execution?: Partial<ExecutionConfig>;
  security?: Partial<SecurityConfig>;
}

/** Merge user/project overrides over defaults (arrays are replaced, not merged). */
export function mergeConfig(base: AppConfig, overrides: ConfigOverrides): AppConfig {
  return {
    ...base,
    ...overrides,
    ai: {
      ...base.ai,
      ...(overrides.ai ?? {}),
      providers: overrides.ai?.providers ?? base.ai.providers,
    },
    analysis: { ...base.analysis, ...(overrides.analysis ?? {}) },
    indexing: { ...base.indexing, ...(overrides.indexing ?? {}) },
    execution: { ...base.execution, ...(overrides.execution ?? {}) },
    security: { ...base.security, ...(overrides.security ?? {}) },
  };
}

export interface ConfigIssue {
  path: string;
  message: string;
}

/** Explicit validation — returns issues instead of throwing. */
export function validateConfig(config: AppConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!config.dataDir) issues.push({ path: 'dataDir', message: 'dataDir is required.' });
  if (config.analysis.maxFilesPerRun <= 0) {
    issues.push({ path: 'analysis.maxFilesPerRun', message: 'Must be positive.' });
  }
  if (config.indexing.maxFiles <= 0) {
    issues.push({ path: 'indexing.maxFiles', message: 'Must be positive.' });
  }
  if (config.execution.maxOutputBytes <= 0) {
    issues.push({ path: 'execution.maxOutputBytes', message: 'Must be positive.' });
  }
  for (const provider of config.ai.providers) {
    if (!provider.id) issues.push({ path: 'ai.providers[].id', message: 'Provider id required.' });
    if (provider.timeoutMs <= 0) {
      issues.push({ path: `ai.providers.${provider.id}.timeoutMs`, message: 'Must be positive.' });
    }
  }
  return issues;
}

/** Safe summary for diagnostics — contains no secrets by construction. */
export function describeConfig(config: AppConfig): Record<string, unknown> {
  return {
    version: config.version,
    dataDir: config.dataDir,
    aiProviders: config.ai.providers.map((p) => ({
      id: p.id,
      kind: p.kind,
      hasCredential: Boolean(p.credentialRef),
    })),
    analysis: config.analysis,
    indexing: config.indexing,
    execution: config.execution,
    security: config.security,
  };
}
