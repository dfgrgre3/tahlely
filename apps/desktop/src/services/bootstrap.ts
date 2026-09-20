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
  startAnalysis,
} from '@tahlely/application';
import {
  AnalysisEngine,
  DeadCodeAnalyzer,
  DuplicationAnalyzer,
  ImportAnalyzer,
  SecurityHeuristicsAnalyzer,
  SyntaxHeuristicsAnalyzer,
  getProfile,
} from '@tahlely/analysis';
import type { AnalyzerFile } from '@tahlely/analysis';
import { MockProvider, ProviderRegistry } from '@tahlely/ai';
import { AgentService, builtinAgents } from '@tahlely/agents';
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
import { buildReport } from '@tahlely/reporting';
import type {
  Agent,
  AgentRun,
  AnalysisId,
  AnalysisMode,
  AnalysisRun,
  ConversationId,
  Project,
  ProjectId,
  Provider,
  ProviderId,
  Report,
  TaskId,
  TaskRecord,
} from '@tahlely/domain';
import { AppError, isTerminal, utcNow } from '@tahlely/domain';
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
    new SyntaxHeuristicsAnalyzer(),
    new ImportAnalyzer(),
    new DuplicationAnalyzer(),
    new DeadCodeAnalyzer(),
    new SecurityHeuristicsAnalyzer(),
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
const demoFilesystems = new Map<string, MemoryFileSystem>();

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
  const provider = services.registry.getOrCreate({
    id: 'mock' as ProviderId,
    name: 'Mock (offline)',
    kind: 'local',
    enabled: true,
    createdAt: utcNow(),
    updatedAt: utcNow(),
  });
  try {
    const response = await provider.chat({
      model: 'mock/mock-reviewer',
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

export async function decideApproval(requestId: string, approve: boolean): Promise<void> {
  const fs = new MemoryFileSystem();
  await decidePermission(ctxWith(fs), { requestId, approve, actor: 'user' });
}

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

/**
 * Single reviewer-style agent run with read-only project tools.
 * Write tools are intentionally unwired in Prompt 1: the agent can reason
 * and cite files, but every mutation still goes through permission requests.
 */
export async function runAgentNow(
  agent: Agent,
  projectId: ProjectId,
  goal: string,
  signal?: AbortSignal,
): Promise<AgentRun> {
  const project = await services.projects.getProject(projectId);
  if (!project) {
    throw new AppError('Project not found.', { kind: 'not-found', code: 'PROJECT_MISSING' });
  }
  const fs = fsFor(project);
  const provider = services.registry.getOrCreate({
    id: 'mock' as ProviderId,
    name: 'Mock (offline)',
    kind: 'local',
    enabled: true,
    createdAt: utcNow(),
    updatedAt: utcNow(),
  });
  const service = new AgentService(services.bus, provider, services.agents, {
    execute: async (tool, args) => {
      if (tool === 'read_file' && typeof args['path'] === 'string') {
        return fs.readTextFile(args['path']);
      }
      if (tool === 'list_dir' && typeof args['path'] === 'string') {
        return (await fs.listDirectory(args['path'])).join('\n');
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
    goal,
    model: 'mock/mock-reviewer',
    contextFiles,
    policies: await services.policies.listPolicies(),
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

export { MockProvider };
