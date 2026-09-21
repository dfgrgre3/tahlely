import type {
  AgentRepository,
  AnalysisRepository,
  AuditRepository,
  ChangeRepository,
  ConversationRepository,
  FileIndexRepository,
  FileSystemPort,
  PolicyRepository,
  ProjectRepository,
  ReportRepository,
  ServiceContext,
} from '@tahlely/application';
import {
  EventBus,
  TaskManager,
  createConversation,
  decidePermission,
  openProject,
  postMessage,
  requestPermission,
  startAnalysis,
} from '@tahlely/application';
import {
  AnalysisEngine,
  ApiContractAnalyzer,
  ArchitectureAnalyzer,
  CompilerAnalyzer,
  ComplexityAnalyzer,
  ConfigAnalyzer,
  GoAnalyzer,
  ProtoAnalyzer,
  ScriptsAnalyzer,
  DeadCodeAnalyzer,
  DeepCorrectnessAnalyzer,
  DependencyAnalyzer,
  DuplicationAnalyzer,
  ErrorHandlingAnalyzer,
  ImportAnalyzer,
  ProjectHygieneAnalyzer,
  ProjectStructureAnalyzer,
  SecurityHeuristicsAnalyzer,
  StrictQualityAnalyzer,
  StyleConsistencyAnalyzer,
  SyntaxHeuristicsAnalyzer,
  UniversalAnalyzer,
  getProfile,
} from '@tahlely/analysis';
import type { AnalyzerFile } from '@tahlely/analysis';
import { MockProvider, PROVIDER_PRESETS, ProviderRegistry, presetToProvider } from '@tahlely/ai';
import { AgentService, builtinAgentGoals, builtinAgents } from '@tahlely/agents';
import {
  Logger,
  MemoryFileSystem,
  MemorySink,
  TauriFileSystem,
  discoverProject,
  indexProject,
} from '@tahlely/infrastructure';
import {
  MemoryAgentRepository,
  MemoryAnalysisRepository,
  MemoryAuditRepository,
  MemoryChangeRepository,
  MemoryFileIndexRepository,
  MemoryReportRepository,
} from '@tahlely/persistence/memory';
import { buildReport, render, renderFileCoverageMarkdown, renderFolderCoverageMarkdown, buildFolderFileCoverage, sortFindings } from '@tahlely/reporting';
import type {
  Agent,
  AgentRole,
  AgentRun,
  AnalysisId,
  AnalysisMode,
  AnalysisRun,
  ConversationId,
  Permission,
  Project,
  ProjectId,
  Provider,
  ProviderId,
  Report,
  TaskId,
  TaskRecord,
} from '@tahlely/domain';
import { AppError, isTerminal, newId, utcNow } from '@tahlely/domain';
import { isTauri, tauriInvoke } from './tauri-bridge.js';
import {
  WebConversationRepository,
  WebDocumentStore,
  WebPolicyRepository,
  WebProjectRepository,
} from './storage.js';

export interface Services {
  bus: EventBus;
  tasks: TaskManager;
  logger: Logger;
  sink: MemorySink;
  projects: ProjectRepository;
  conversations: ConversationRepository;
  analyses: AnalysisRepository;
  policies: PolicyRepository;
  changes: ChangeRepository;
  reports: ReportRepository;
  audit: AuditRepository;
  fileIndex: FileIndexRepository;
  agents: AgentRepository;
  engine: AnalysisEngine;
  registry: ProviderRegistry;
}

function createServices(): Services {
  const bus = new EventBus();
  const sink = new MemorySink();
  const logger = new Logger({ sinks: [sink] });
  const web = new WebDocumentStore();
  const analyses = new MemoryAnalysisRepository();
  const engine = new AnalysisEngine(bus, [
    new CompilerAnalyzer(),
    new ArchitectureAnalyzer(),
    new ConfigAnalyzer(),
    new ApiContractAnalyzer(),
    new GoAnalyzer(),
    new ScriptsAnalyzer(),
    new ProtoAnalyzer(),
    new DeepCorrectnessAnalyzer(),
    new StrictQualityAnalyzer(),
    new SecurityHeuristicsAnalyzer(),
    new DependencyAnalyzer(),
    new ComplexityAnalyzer(),
    new ProjectHygieneAnalyzer(),
    new StyleConsistencyAnalyzer(),
    new ErrorHandlingAnalyzer(),
    new UniversalAnalyzer(),
    new ProjectStructureAnalyzer(),
    new SyntaxHeuristicsAnalyzer(),
    new ImportAnalyzer(),
    new DuplicationAnalyzer(),
    new DeadCodeAnalyzer(),
  ]);
  const registry = new ProviderRegistry();
  registry.getOrCreate({
    id: 'mock' as ProviderId,
    name: 'Mock (offline)',
    kind: 'local',
    enabled: true,
    createdAt: utcNow(),
    updatedAt: utcNow(),
  });
  return {
    bus,
    tasks: new TaskManager(),
    logger,
    sink,
    projects: new WebProjectRepository(web),
    conversations: new WebConversationRepository(web),
    analyses,
    policies: new WebPolicyRepository(web),
    changes: new MemoryChangeRepository(),
    reports: new MemoryReportRepository(),
    audit: new MemoryAuditRepository(),
    fileIndex: new MemoryFileIndexRepository(),
    agents: new MemoryAgentRepository(),
    engine,
    registry,
  };
}

/** Composition root singleton. Views never construct services directly. */
export const services: Services = createServices();

/** Demo filesystem per demo project id (works in browser and Tauri). */
const demoFilesystems = new Map<string, FileSystemPort>();

/** Register an in-memory filesystem for a project (uploaded folders, demos). */
export function registerProjectFileSystem(projectId: string, fs: FileSystemPort): void {
  demoFilesystems.set(projectId, fs);
}

const DEMO_SEED: Record<string, string> = {
  '/demo/sample/package.json': JSON.stringify(
    { name: 'sample', version: '1.0.0', main: 'src/index.ts' },
    null,
    2,
  ),
  '/demo/sample/src/index.ts': [
    "import { helper } from './util';",
    "import { missing } from './does-not-exist';",
    '',
    '// TODO: wire up the missing module',
    'export function main(): void {',
    '  console.log(helper());',
    '}',
    '',
  ].join('\n'),
  '/demo/sample/src/util.ts': [
    'export function helper(): number {',
    '  return 42;',
    '}',
    '',
    'export function orphaned(): number {',
    '  return -1;',
    '}',
    '',
  ].join('\n'),
  '/demo/sample/src/config.ts': [
    'export const password = "s3cret-value";',
    'export function load(input: string): unknown {',
    '  return eval(input);',
    '}',
    '',
  ].join('\n'),
};

function ctxWith(fs: FileSystemPort): ServiceContext {
  return {
    projects: services.projects,
    conversations: services.conversations,
    analyses: services.analyses,
    policies: services.policies,
    changes: services.changes,
    audit: services.audit,
    fs,
    events: services.bus,
  };
}

function fsFor(project: Project): FileSystemPort {
  const demo = demoFilesystems.get(project.id);
  if (demo) return demo;
  if (isTauri()) return new TauriFileSystem(tauriInvoke);
  throw new AppError('This project lives on disk — open it from the Tauri desktop build.', {
    kind: 'validation',
    code: 'FS_REQUIRES_TAURI',
  });
}

/** Open a real folder (Tauri) or throw a friendly error in the browser. */
export async function openFolderProject(rootPath: string, name: string): Promise<Project> {
  if (!isTauri()) {
    throw new AppError('Opening local folders requires the Tauri desktop build.', {
      kind: 'validation',
      code: 'FS_REQUIRES_TAURI',
    });
  }
  const registered = await tauriInvoke<string>('register_root', { path: rootPath });
  const fs = new TauriFileSystem(tauriInvoke);
  const project = await openProject(ctxWith(fs), { name, rootPath: registered });
  const discovery = await discoverProject(fs, project.rootPath);
  const enriched: Project = {
    ...project,
    kind: discovery.kind,
    languages: discovery.languages,
    frameworks: discovery.frameworks,
    packageManagers: discovery.packageManagers,
    entryPoints: discovery.entryPoints,
    updatedAt: utcNow(),
  };
  await services.projects.saveProject(enriched);
  return enriched;
}

/** One-click demo project that exercises the full pipeline anywhere. */
export async function loadDemoProject(): Promise<Project> {
  const fs = new MemoryFileSystem(DEMO_SEED);
  const project = await openProject(ctxWith(fs), {
    name: 'Sample (demo)',
    rootPath: '/demo/sample',
  });
  demoFilesystems.set(project.id, fs);
  const discovery = await discoverProject(fs, project.rootPath);
  const enriched: Project = {
    ...project,
    kind: 'node',
    languages: discovery.languages,
    frameworks: discovery.frameworks,
    packageManagers: discovery.packageManagers,
    entryPoints: discovery.entryPoints,
    updatedAt: utcNow(),
  };
  await services.projects.saveProject(enriched);
  return enriched;
}

export async function ensureConversation(projectId: ProjectId): Promise<string> {
  const existing = await services.conversations.listConversations(projectId);
  if (existing[0]) return existing[0].id;
  const fs = new MemoryFileSystem();
  const conversation = await createConversation(ctxWith(fs), { projectId });
  return conversation.id;
}

/**
 * Full tool-only/hybrid pipeline: run record → incremental index →
 * analyzer engine → persisted findings. Returns the TaskRecord; the run
 * record is available as task.result.
 */
export async function runProjectAnalysis(
  projectId: ProjectId,
  profileId: string,
  mode: AnalysisMode,
  onProgress?: (completed: number, total: number) => void,
): Promise<TaskRecord> {
  const project = await services.projects.getProject(projectId);
  if (!project) {
    throw new AppError('Project not found.', { kind: 'not-found', code: 'PROJECT_MISSING' });
  }
  const profile = getProfile(profileId);
  const fs = fsFor(project);
  const task = services.tasks.create({
    type: 'analysis',
    title: `${profile.label} — ${project.name}`,
    projectId,
  });
  void services.tasks.run(task.id, async (ctx) => {
    const started = await startAnalysis(ctxWith(fs), {
      projectId,
      mode,
      profileId: profile.id,
      analyzers: profile.analyzers,
      targetPaths: [],
    });
    ctx.reportProgress(0.05);
    const outcome = await indexProject(fs, projectId, project.rootPath, {
      maxFiles: profile.maxFiles,
      maxFileSizeBytes: 1024 * 1024,
      extraIgnores: profile.ignoredPaths,
      respectGitignore: true,
      signal: ctx.signal,
    });
    await services.fileIndex.clearProject(projectId);
    await services.fileIndex.upsertFiles(outcome.files);
    ctx.reportProgress(0.2);
    const analyzerFiles: AnalyzerFile[] = [];
    for (const node of outcome.files) {
      ctx.throwIfCancelled();
      if (node.binary || node.generated) {
        analyzerFiles.push({ node });
        continue;
      }
      try {
        const content = await fs.readTextFile(node.path);
        analyzerFiles.push({ node, content: content.slice(0, 200000) });
      } catch {
        analyzerFiles.push({ node });
      }
    }
    const { run } = await services.engine.execute(
      { ...started, analyzerIds: profile.analyzers },
      analyzerFiles,
      {
        saveRun: (value) => services.analyses.saveRun(value),
        saveFindings: (values) => services.analyses.saveFindings(values),
      },
      {
        onProgress: (completed, total) => {
          ctx.throwIfCancelled();
          onProgress?.(completed, total);
          ctx.reportProgress(0.2 + 0.8 * (completed / Math.max(1, total)));
        },
      },
    );
    return run;
  });
  return services.tasks.get(task.id);
}

/** Poll a background task until it reaches a terminal status. */
export async function waitForTask(id: TaskId, timeoutMs = 600000): Promise<TaskRecord> {
  const start = Date.now();
  for (;;) {
    const task = services.tasks.get(id);
    if (isTerminal(task.status)) return task;
    if (Date.now() - start > timeoutMs) {
      throw new AppError('Timed out waiting for the background task.', { kind: 'timeout' });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function buildProjectReport(
  projectId: ProjectId,
  analysisId: string,
  title: string,
): Promise<Report> {
  const findings = await services.analyses.listFindings(projectId, analysisId);
  const report = buildReport({
    projectId,
    analysisIds: [analysisId as AnalysisId],
    title,
    format: 'markdown',
    findings,
    generatedBy: 'tool',
  });
  await services.reports.saveReport(report);
  await services.bus.emit(
    'ReportGenerated',
    { projectId, reportId: report.id, format: report.format },
    projectId,
  );
  return report;
}

/** Conversation reply via the configured (default: mock) provider. */
export async function askAssistant(conversationId: string, text: string): Promise<void> {
  const conversation = await services.conversations.getConversation(conversationId);
  if (!conversation) {
    throw new AppError('Conversation not found.', {
      kind: 'not-found',
      code: 'CONVERSATION_MISSING',
    });
  }
  const fs = new MemoryFileSystem();
  const ctx = ctxWith(fs);
  await postMessage(ctx, {
    conversationId: conversationId as ConversationId,
    role: 'user',
    body: text,
  });
  const history = await services.conversations.listMessages(conversationId);
  const modelRef = activeModelRef();
  const resolvedProvider = providerForModel(modelRef);
  const provider = services.registry.getOrCreate(resolvedProvider, {
    apiKey: sessionKeyFor(resolvedProvider.id),
  });
  try {
    const response = await provider.chat({
      model: modelRef,
      messages: history.slice(-20).map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.body,
      })),
    });
    await postMessage(ctx, {
      conversationId: conversationId as ConversationId,
      role: 'assistant',
      body: response.content,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await postMessage(ctx, {
      conversationId: conversationId as ConversationId,
      role: 'assistant',
      body: `Assistant request failed: ${message}`,
    });
  }
}

export async function seedAgents(): Promise<void> {
  const existing = await services.agents.listAgents();
  if (existing.length > 0) return;
  for (const agent of builtinAgents()) {
    await services.agents.saveAgent(agent);
  }
}

export async function decideApproval(
  requestId: string,
  approve: boolean,
  note?: string,
): Promise<void> {
  const fs = new MemoryFileSystem();
  await decidePermission(ctxWith(fs), { requestId, approve, actor: 'user', note });
}

/**
 * Ask the user (Approvals surface) for permission to delete a project file.
 * Nothing is deleted until the request is approved — see the subscriber below.
 */
export async function requestFileDeletion(
  projectId: ProjectId,
  relativePath: string,
  reason: string,
): Promise<void> {
  const fs = new MemoryFileSystem();
  await requestPermission(ctxWith(fs), {
    projectId,
    permission: 'DELETE_FILE',
    action: `Delete file ${relativePath}`,
    target: relativePath,
    reason,
  });
}

/**
 * Enforcement bridge: approved DELETE_FILE requests actually remove the file
 * from the project filesystem and index, with an audit trail. Approved
 * WRITE_FILE requests flush their staged content. Rejections are
 * no-ops by design — deny is always safe.
 */
const pendingWrites = new Map<string, { projectId: ProjectId; path: string; content: string }>();

/** Stage a file edit behind a WRITE_FILE permission request. Nothing is written until approved. */
export async function requestFileWrite(
  projectId: ProjectId,
  path: string,
  content: string,
  reason: string,
): Promise<string> {
  const fs = new MemoryFileSystem();
  const request = await requestPermission(ctxWith(fs), {
    projectId,
    permission: 'WRITE_FILE',
    action: `Edit file ${path}`,
    target: path,
    reason,
  });
  pendingWrites.set(request.id, { projectId, path, content });
  return request.id;
}
services.bus.on('PermissionApproved', (event) => {
  (async () => {
    const request = await services.policies.getRequest(event.payload.requestId);
    if (!request || !request.target) return;
    const project = await services.projects.getProject(request.projectId);
    if (!project) return;
    const fs = fsFor(project);
    if (request.permission === 'WRITE_FILE') {
      const staged = pendingWrites.get(request.id);
      if (!staged) return;
      const absolute = request.target.startsWith('/')
        ? request.target
        : `${project.rootPath}/${request.target}`;
      await fs.writeTextFile(staged.path.startsWith('/') ? staged.path : absolute, staged.content);
      pendingWrites.delete(request.id);
      await services.audit.append({
        id: newId('audit'),
        projectId: project.id,
        category: 'security',
        action: 'file.edited',
        actor: 'user',
        target: request.target,
        metadata: { requestId: request.id, note: request.decisionNote },
        at: utcNow(),
      });
      return;
    }
    if (request.permission !== 'DELETE_FILE') return;
    const absolute = request.target.startsWith('/')
      ? request.target
      : `${project.rootPath}/${request.target}`;
    await fs.deletePath(absolute);
    await services.fileIndex.removeFiles(project.id, [absolute]);
    await services.audit.append({
      id: newId('audit'),
      projectId: project.id,
      category: 'security',
      action: 'file.deleted',
      actor: 'user',
      target: request.target,
      metadata: { requestId: request.id, note: request.decisionNote },
      at: utcNow(),
    });
  })().catch(() => {
    // Deletion failures never crash the shell; the file simply stays.
  });
});

services.bus.on('PermissionRejected', (event) => {
  pendingWrites.delete(event.payload.requestId);
});

function sanitizePathPart(value: string): string {
  return (
    value
      .replace(/[^\p{L}\p{N} _.-]/gu, '')
      .trim()
      .slice(0, 60) || 'untitled'
  );
}

/**
 * Report persistence: in the Tauri desktop build every generated report is
 * also written to `<project>/.tahlely/reports/<conversation>/<title>.md`, so
 * each conversation owns a real report folder on disk. In the browser the
 * same reports are downloadable from the File Analyzer sidebar instead.
 */
services.bus.on('ReportGenerated', (event) => {
  (async () => {
    if (!isTauri()) return;
    const [report, project] = await Promise.all([
      services.reports.getReport(event.payload.reportId),
      services.projects.getProject(event.payload.projectId),
    ]);
    if (!report || !project || demoFilesystems.has(project.id)) return;
    let folder = 'general';
    if (report.conversationId) {
      const conversation = await services.conversations.getConversation(report.conversationId);
      if (conversation) folder = sanitizePathPart(conversation.title);
    }
    const path = `${project.rootPath}/.tahlely/reports/${folder}/${sanitizePathPart(report.title)}.md`;
    await new TauriFileSystem(tauriInvoke).writeTextFile(path, render(report));
  })().catch(() => {
    // Disk persistence is best-effort; the in-memory report is authoritative.
  });
});

export function listTasks(projectId?: ProjectId): TaskRecord[] {
  return services.tasks.list(projectId);
}

export function currentRun(projectId: ProjectId): Promise<AnalysisRun | undefined> {
  return services.analyses.listRuns(projectId).then((runs) => runs[runs.length - 1]);
}

/** Read a single project file through the guarded filesystem port. */
export async function readProjectFile(projectId: ProjectId, path: string): Promise<string> {
  const project = await services.projects.getProject(projectId);
  if (!project) {
    throw new AppError('Project not found.', { kind: 'not-found', code: 'PROJECT_MISSING' });
  }
  return fsFor(project).readTextFile(path);
}

export function listProjectFiles(
  projectId: ProjectId,
): ReturnType<FileIndexRepository['listFiles']> {
  return services.fileIndex.listFiles(projectId);
}

export function listAgentRuns(projectId: ProjectId): Promise<AgentRun[]> {
  return services.agents.listRuns(projectId);
}

export interface AgentRunOptions {
  /** Model ref 'providerId/modelName' — defaults to the offline mock. */
  model?: string;
  conversationId?: string;
  signal?: AbortSignal;
}

/** Session-only API key lookup (mirrors services/providers.ts — never localStorage). */
export function sessionKeyFor(providerId: string): string | undefined {
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(`tahlely.v1.provider-keys.${providerId}`) ?? undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Active model ref chosen in Models view (localStorage — the ref only, never the key). */
export function activeModelRef(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('tahlely.v1.active-model') ?? 'mock/mock-reviewer';
    }
  } catch {
    // ignore
  }
  return 'mock/mock-reviewer';
}

/** Resolve a model ref to its provider (presets + custom API providers included). */
export function providerForModel(ref?: string): Provider {
  const fallback: Provider = {
    id: 'mock' as ProviderId,
    name: 'Mock (offline)',
    kind: 'local',
    enabled: true,
    createdAt: utcNow(),
    updatedAt: utcNow(),
  };
  if (!ref) return fallback;
  const [providerId] = ref.split('/');
  if (!providerId || providerId === 'mock') return fallback;
  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
  if (preset) {
    return {
      ...(presetToProvider(preset, utcNow()) as Provider),
      id: preset.id as ProviderId,
    };
  }
  const custom = readProviderRecords().find((record) => record.id === providerId);
  if (!custom) return fallback;
  return {
    id: custom.id as ProviderId,
    name: custom.name,
    kind: 'openai-compatible',
    baseUrl: custom.baseUrl,
    enabled: true,
    createdAt: utcNow(),
    updatedAt: utcNow(),
  };
}

/**
 * Single reviewer-style agent run. Write tools execute only after the
 * permission gate resolves; the model ref selects provider per run, so
 * several agents with different models can run concurrently on one project.
 */
export async function runAgentNow(
  agent: Agent,
  projectId: ProjectId,
  goal: string,
  options: AgentRunOptions = {},
): Promise<AgentRun> {
  const signal = options.signal;
  const project = await services.projects.getProject(projectId);
  if (!project) {
    throw new AppError('Project not found.', { kind: 'not-found', code: 'PROJECT_MISSING' });
  }
  const fs = fsFor(project);
  const resolved = providerForModel(options.model);
  const provider = services.registry.getOrCreate(resolved, { apiKey: sessionKeyFor(resolved.id) });
  const service = new AgentService(services.bus, provider, services.agents, {
    execute: async (tool, args) => {
      if (tool === 'read_file' && typeof args['path'] === 'string') {
        return fs.readTextFile(args['path']);
      }
      if (tool === 'list_dir' && typeof args['path'] === 'string') {
        return (await fs.listDirectory(args['path'])).join('\n');
      }
      // Write tools only ever run after the permission gate approved them.
      if (
        (tool === 'write_file' || tool === 'propose_patch') &&
        typeof args['path'] === 'string' &&
        typeof args['content'] === 'string'
      ) {
        await fs.writeTextFile(args['path'], args['content']);
        return `wrote ${args['path']}`;
      }
      if (tool === 'delete_file' && typeof args['path'] === 'string') {
        await fs.deletePath(args['path']);
        return `deleted ${args['path']}`;
      }
      throw new AppError(`Tool not wired in Prompt 1: ${tool}`, {
        kind: 'execution',
        code: 'AGENT_TOOL_UNWIRED',
      });
    },
  });
  const files = (await services.fileIndex.listFiles(projectId)).slice(0, 8);
  const contextFiles: { path: string; content: string }[] = [];
  for (const file of files) {
    if (file.binary || file.generated) continue;
    try {
      contextFiles.push({
        path: file.relativePath,
        content: (await fs.readTextFile(file.path)).slice(0, 4000),
      });
    } catch {
      // Unreadable files are simply omitted from agent context.
    }
  }
  return service.run({
    agent,
    projectId,
    conversationId: options.conversationId,
    goal,
    model: options.model ?? 'mock/mock-reviewer',
    contextFiles,
    policies: await services.policies.listPolicies(),
    onPermissionRequired: async ({ permission, action, target }) => {
      // Create a pending request on the Approvals surface, then wait for the
      // user's decision. The agent run pauses; deny is always safe.
      const request = await requestPermission(ctxWith(new MemoryFileSystem()), {
        projectId,
        agentId: agent.id,
        permission,
        action,
        target,
        reason: `Agent ${agent.name} requests ${permission}`,
      });
      const started = Date.now();
      for (;;) {
        const current = await services.policies.getRequest(request.id);
        if (current?.status === 'approved') return true;
        if (current?.status === 'rejected') return false;
        if (Date.now() - started > 10 * 60_000) return false;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    },
    signal,
  });
}

export interface CustomProviderRecord {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
}

const PROVIDER_KEY = 'tahlely.v1.custom-providers';

function readProviderRecords(): CustomProviderRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(PROVIDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomProviderRecord[]) : [];
  } catch {
    return [];
  }
}

/** Custom OpenAI-compatible providers (endpoints only — keys stay in memory). */
export function listCustomProviders(): CustomProviderRecord[] {
  return readProviderRecords();
}

export function addCustomProvider(record: CustomProviderRecord): CustomProviderRecord[] {
  const records = [...readProviderRecords(), record];
  try {
    localStorage.setItem(PROVIDER_KEY, JSON.stringify(records));
  } catch {
    // Non-persistent runtimes keep the in-memory registry only.
  }
  const provider: Provider = {
    id: record.id as ProviderId,
    name: record.name,
    kind: 'openai-compatible',
    baseUrl: record.baseUrl,
    enabled: true,
    createdAt: utcNow(),
    updatedAt: utcNow(),
  };
  services.registry.getOrCreate(provider, {});
  return records;
}

export async function testProvider(record: CustomProviderRecord): Promise<string[]> {
  const provider: Provider = {
    id: record.id as ProviderId,
    name: record.name,
    kind: 'openai-compatible',
    baseUrl: record.baseUrl,
    enabled: true,
    createdAt: utcNow(),
    updatedAt: utcNow(),
  };
  const instance = services.registry.getOrCreate(provider, {});
  const models = await instance.listModels();
  return models.map((model) => model.name);
}

/**
 * Tool-only comprehensive report (no AI, fully deterministic). Produces a
 * strict, per-file markdown audit: severity totals, every file with its error
 * lines and fixes, top rules, and clean files — straight from the analyzers.
 */
export async function buildToolProjectReport(
  projectId: ProjectId,
  options: { analysisId?: string; conversationId?: string; title?: string } = {},
): Promise<Report> {
  const project = await services.projects.getProject(projectId);
  if (!project) {
    throw new AppError('Project not found.', { kind: 'not-found', code: 'PROJECT_MISSING' });
  }
  const runs = await services.analyses.listRuns(projectId);
  const run = options.analysisId
    ? runs.find((candidate) => candidate.id === options.analysisId)
    : runs[runs.length - 1];
  const findings = run ? await services.analyses.listFindings(projectId, run.id) : [];
  const ranked = sortFindings(findings);

  const report = buildReport({
    projectId,
    analysisIds: run ? [run.id] : [],
    conversationId: options.conversationId as Report['conversationId'],
    title: options.title ?? `Strict tool analysis — ${project.name}`,
    format: 'markdown',
    findings,
    generatedBy: 'tool',
  });

  const byFile = new Map<string, typeof ranked>();
  const bySeverity: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  for (const finding of ranked) {
    const key = finding.path ?? '(project-wide)';
    const bucket = byFile.get(key) ?? [];
    bucket.push(finding);
    byFile.set(key, bucket);
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
  }

  const files = await services.fileIndex.listFiles(projectId);
  const scannedFiles = files.filter((file) => !file.binary && !file.generated);
  const cleanFiles = scannedFiles
    .map((file) => file.relativePath)
    .filter((relativePath) => !byFile.has(relativePath));

  // Real per-folder + per-file coverage over EVERY indexed file (no sampling).
  const coverage = buildFolderFileCoverage(
    files.map((file) => ({ relativePath: file.relativePath, binary: file.binary, generated: file.generated })),
    ranked,
  );

  const overview = [
    `Project: ${project.name} (${project.kind}) · root ${project.rootPath}`,
    `Analysis: profile ${run?.profileId ?? 'n/a'} · mode ${run?.mode ?? 'n/a'} · findings ${ranked.length}`,
    `Files indexed: ${files.length} · analyzed: ${scannedFiles.length} · clean: ${cleanFiles.length}`,
    `Severity: ${['critical', 'high', 'medium', 'low', 'info']
      .map((severity) => `${severity}=${bySeverity[severity] ?? 0}`)
      .join(' · ')}`,
    '',
    'Top rules:',
    ...Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([ruleId, count]) => `- ${ruleId} — ${count}`),
  ].join('\n');

  const fileSections = [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([path, items]) => {
      const lines = items
        .map(
          (finding) =>
            `- **${finding.severity}** · line ${finding.line ?? '–'} · \`${finding.ruleId}\`\n` +
            `  - Issue: ${finding.title}\n` +
            `  - Why: ${finding.description}\n` +
            `  - Fix: ${finding.recommendation ?? 'review manually'}` +
            (finding.suggestedFix
              ? `\n  - Suggested line: \`${finding.suggestedFix.trim()}\``
              : ''),
        )
        .join('\n');
      return `### ${path} (${items.length} issues)\n\n${lines}`;
    })
    .join('\n\n');

  report.sections.unshift({
    id: 'tool-overview',
    title: 'Deterministic analysis overview',
    body: overview,
    findingIds: ranked.map((finding) => finding.id),
  });
  report.sections.push({
    id: 'per-file-issues',
    title: 'Per-file issues with exact lines',
    body: fileSections || 'No issues found by the deterministic analyzers.',
    findingIds: ranked.map((finding) => finding.id),
  });
  report.sections.push({
    id: 'clean-files',
    title: 'Files with no findings',
    body: cleanFiles.length > 0 ? cleanFiles.map((path) => `- ${path}`).join('\n') : 'None.',
    findingIds: [],
  });
  report.sections.push({
    id: 'folder-coverage',
    title: `Per-folder coverage (${coverage.folders.length} folders, every folder listed)`,
    body: renderFolderCoverageMarkdown(coverage.folders),
    findingIds: ranked.map((finding) => finding.id),
  });
  report.sections.push({
    id: 'file-coverage',
    title: `Per-file coverage (${coverage.files.length} files, every file listed)`,
    body: renderFileCoverageMarkdown(coverage.files),
    findingIds: ranked.map((finding) => finding.id),
  });

  await services.reports.saveReport(report);
  await services.bus.emit(
    'ReportGenerated',
    { projectId, reportId: report.id, format: report.format },
    projectId,
  );
  return report;
}

/**
 * AI comprehensive report: feeds the strict analysis results (severity-ranked
 * findings with file:line, plus the highest-risk code excerpts) to the chosen
 * model and stores the generated narrative as a full report. Falls back to the
 * offline mock provider when no API model is configured.
 */
export async function buildAiProjectReport(
  projectId: ProjectId,
  options: { analysisId?: string; model?: string; conversationId?: string; title?: string } = {},
): Promise<Report> {
  const project = await services.projects.getProject(projectId);
  if (!project) {
    throw new AppError('Project not found.', { kind: 'not-found', code: 'PROJECT_MISSING' });
  }
  const runs = await services.analyses.listRuns(projectId);
  const run = options.analysisId
    ? runs.find((candidate) => candidate.id === options.analysisId)
    : runs[runs.length - 1];
  const findings = run ? await services.analyses.listFindings(projectId, run.id) : [];
  const ranked = sortFindings(findings);
  const top = ranked.slice(0, 60);
  const bySeverity = ranked.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});
  const byFile = ranked.reduce<Record<string, number>>((acc, finding) => {
    if (finding.path) acc[finding.path] = (acc[finding.path] ?? 0) + 1;
    return acc;
  }, {});
  const worstFiles = Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => `${path} (${count})`);

  // Code excerpts around the most severe findings give the model real context.
  const excerpts: string[] = [];
  for (const finding of top.slice(0, 12)) {
    if (!finding.path || !finding.line) continue;
    try {
      const relative = finding.path.replace(/^\/+/, '');
      const node = (await services.fileIndex.listFiles(projectId)).find(
        (file) => file.relativePath === relative || file.path.endsWith(`/${relative}`),
      );
      if (!node || node.binary) continue;
      const content = await readProjectFile(projectId, node.path);
      const lines = content.split('\n');
      const from = Math.max(0, finding.line - 4);
      const to = Math.min(lines.length, finding.line + 3);
      excerpts.push(
        `### ${finding.path}:${finding.line} — ${finding.title}\n\`\`\`\n${lines
          .slice(from, to)
          .map((line, index) => `${from + index + 1}: ${line}`)
          .join('\n')}\n\`\`\``,
      );
    } catch {
      // Unreadable files simply contribute no excerpt.
    }
  }

  const prompt = [
    `Project: ${project.name} (${project.kind}, languages: ${project.languages.join(', ') || 'n/a'})`,
    `Analysis run: ${run?.id ?? 'none'} · profile ${run?.profileId ?? 'n/a'} · mode ${run?.mode ?? 'n/a'}`,
    `Files scanned: ${run?.summary?.filesScanned ?? 0} · findings: ${ranked.length}`,
    `Severity breakdown: ${JSON.stringify(bySeverity)}`,
    `Worst files: ${worstFiles.join(', ') || 'none'}`,
    '',
    'Findings (severity, file:line, rule, title, recommendation):',
    ...top.map(
      (finding) =>
        `- [${finding.severity}] ${finding.path ?? '(project-wide)'}${finding.line ? `:${finding.line}` : ''} ` +
        `| ${finding.ruleId} | ${finding.title} | ${finding.recommendation ?? finding.description}`,
    ),
    '',
    excerpts.length > 0 ? 'Representative code excerpts:' : '',
    ...excerpts,
  ].join('\n');

  const reportModel = options.model ?? activeModelRef();
  const reportProvider = providerForModel(reportModel);
  const provider = services.registry.getOrCreate(reportProvider, {
    apiKey: sessionKeyFor(reportProvider.id),
  });
  const response = await provider.chat({
    model: reportModel,
    messages: [
      {
        role: 'system',
        content:
          'You are a senior engineering reviewer doing a real project audit. Do not force the answer into a rigid template. ' +
          'Write a comprehensive, evidence-based assessment that covers security, correctness, architecture, maintainability, ' +
          'performance, reliability, testing gaps, operational risk, and any other material issue supported by the findings and code excerpts. ' +
          'Structure it as a real engineering review with these sections in order: Executive summary, Key findings, Root cause analysis, ' +
          'Risk assessment, P0/P1/P2 priorities, Suggested fixes with effort estimates, and Overall assessment. ' +
          'Be specific and honest about confidence, cite file:line when possible, explain trade-offs, and give concrete fixes. ' +
          'If the code is healthy in some areas, say so plainly; if it is weak in others, explain why. Favor depth, clarity, and realism over template wording.',
      },
      { role: 'user', content: prompt },
    ],
  });

  const report = buildReport({
    projectId,
    analysisIds: run ? [run.id] : [],
    conversationId: options.conversationId as Report['conversationId'],
    title: options.title ?? `AI comprehensive report — ${project.name}`,
    format: 'markdown',
    findings,
    generatedBy: 'ai',
  });
  report.sections.unshift({
    id: 'ai-summary',
    title: 'Analysis snapshot',
    body: [
      `Findings: ${ranked.length} (${Object.entries(bySeverity)
        .map(([severity, count]) => `${severity}: ${count}`)
        .join(', ')})`,
      `Files scanned: ${run?.summary?.filesScanned ?? 0}`,
      `Worst files: ${worstFiles.join(', ') || 'none'}`,
      `Model: ${options.model ?? 'mock/mock-reviewer'}`,
    ].join('\n'),
    findingIds: top.map((finding) => finding.id),
  });
  report.sections.push({
    id: 'ai-comprehensive',
    title: 'AI comprehensive report',
    body: response.content,
    findingIds: top.map((finding) => finding.id),
  });
  await services.reports.saveReport(report);
  await services.bus.emit(
    'ReportGenerated',
    { projectId, reportId: report.id, format: report.format },
    projectId,
  );
  return report;
}

export interface AgentFleetResult {
  agentName: string;
  runId?: string;
  status: 'completed' | 'failed';
  error?: string;
  output?: string;
  durationMs: number;
}

/**
 * Launch the whole agent fleet (14 specialized agents) concurrently on one
 * project. Each agent gets its domain goal, its own model ref, and is bound
 * to the active conversation; none blocks the others. Failed agents are
 * reported individually instead of aborting the fleet.
 */
export async function launchAgentFleet(
  projectId: ProjectId,
  options: {
    conversationId?: string;
    model?: string;
    /** Restrict to specific agent names (default: the whole fleet). */
    agentNames?: string[];
    onAgentDone?: (result: AgentFleetResult) => void;
  } = {},
): Promise<AgentFleetResult[]> {
  // Seed the built-in fleet first so launching always has agents to run.
  await seedAgents();
  const agents = await services.agents.listAgents();
  const goals = builtinAgentGoals();
  const selected = options.agentNames
    ? agents.filter((agent) => options.agentNames?.includes(agent.name))
    : agents;

  const results = await Promise.all(
    selected.map(async (agent): Promise<AgentFleetResult> => {
      const started = Date.now();
      try {
        const run = await runAgentNow(agent, projectId, goals[agent.name] ?? agent.instructions, {
          model: options.model,
          conversationId: options.conversationId,
        });
        const result: AgentFleetResult = {
          agentName: agent.name,
          runId: run.id,
          status: run.status === 'completed' ? 'completed' : 'failed',
          output: run.output,
          error: run.error,
          durationMs: Date.now() - started,
        };
        options.onAgentDone?.(result);
        return result;
      } catch (error) {
        const result: AgentFleetResult = {
          agentName: agent.name,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - started,
        };
        options.onAgentDone?.(result);
        return result;
      }
    }),
  );
  return results;
}

/** Tools a user-built agent may request; each maps to a permission gate. */
export const CUSTOM_AGENT_TOOLS: Record<string, { description: string; permission: Permission }> = {
  read_file: { description: 'Read a project file.', permission: 'READ_FILE' },
  list_dir: { description: 'List a project directory.', permission: 'READ_DIRECTORY' },
  write_file: {
    description: 'Write improved content to a file (approval required).',
    permission: 'WRITE_FILE',
  },
  delete_file: {
    description: 'Delete a redundant file (approval required).',
    permission: 'DELETE_FILE',
  },
};

/** Build and persist a custom agent from the UI builder. */
export async function saveCustomAgent(input: {
  name: string;
  role: AgentRole;
  instructions: string;
  toolNames: string[];
}): Promise<Agent> {
  const names = [...new Set(['read_file', ...input.toolNames])];
  const tools = names
    .filter((name) => CUSTOM_AGENT_TOOLS[name])
    .map((name) => ({ name, ...CUSTOM_AGENT_TOOLS[name]! }));
  const now = utcNow();
  const agent: Agent = {
    id: newId('agent'),
    projectId: null,
    name: input.name.trim() || 'Custom agent',
    role: input.role,
    instructions: input.instructions.trim() || 'You are a helpful engineering agent.',
    tools,
    maxSteps: 10,
    createdAt: now,
    updatedAt: now,
  };
  await services.agents.saveAgent(agent);
  return agent;
}

export { MockProvider };
