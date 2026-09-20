import type {
  AgentRepository,
  AnalysisRepository,
  AuditRepository,
  ChangeRepository,
  ConversationRepository,
  FileIndexRepository,
  PolicyRepository,
  ProjectRepository,
  ReportRepository,
} from '@tahlely/application';
import type {
  Agent,
  AgentRun,
  AnalysisRun,
  AuditEvent,
  Conversation,
  FileNode,
  Finding,
  Message,
  Patch,
  PermissionRequest,
  Policy,
  Project,
  Report,
  Snapshot,
  Workspace,
} from '@tahlely/domain';
import { AppError } from '@tahlely/domain';

/**
 * In-memory repositories (platform-free). Used by the desktop webview session
 * state, unit tests, and ephemeral tooling. Same ports as the JSON/SQLite
 * stores, so swapping persistence never touches callers.
 */
class Table<T extends { id: string }> {
  private readonly rows = new Map<string, T>();

  all(): T[] {
    return [...this.rows.values()];
  }

  get(id: string): T | undefined {
    return this.rows.get(id);
  }

  set(value: T): void {
    this.rows.set(value.id, value);
  }

  delete(id: string): void {
    this.rows.delete(id);
  }
}

function requireRow<T extends { id: string }>(table: Table<T>, id: string, code: string): T {
  const row = table.get(id);
  if (!row) {
    throw new AppError(`Record ${id} not found.`, { kind: 'not-found', code });
  }
  return row;
}

export class MemoryProjectRepository implements ProjectRepository {
  private readonly workspaces = new Table<Workspace>();
  private readonly projects = new Table<Project>();

  async listWorkspaces(): Promise<Workspace[]> {
    return this.workspaces.all();
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace);
  }

  async listProjects(): Promise<Project[]> {
    return this.projects.all();
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project);
  }

  async removeProject(id: string): Promise<void> {
    this.projects.delete(id);
  }
}

export class MemoryFileIndexRepository implements FileIndexRepository {
  private readonly files: FileNode[] = [];

  async upsertFiles(files: FileNode[]): Promise<void> {
    const byPath = new Map(this.files.map((f) => [`${f.projectId}::${f.path}`, f]));
    for (const file of files) byPath.set(`${file.projectId}::${file.path}`, file);
    this.files.splice(0, this.files.length, ...byPath.values());
  }

  async listFiles(projectId: string): Promise<FileNode[]> {
    return this.files.filter((f) => f.projectId === projectId);
  }

  async removeFiles(projectId: string, paths: string[]): Promise<void> {
    const doomed = new Set(paths);
    const kept = this.files.filter((f) => f.projectId !== projectId || !doomed.has(f.path));
    this.files.splice(0, this.files.length, ...kept);
  }

  async clearProject(projectId: string): Promise<void> {
    const kept = this.files.filter((f) => f.projectId !== projectId);
    this.files.splice(0, this.files.length, ...kept);
  }
}

export class MemoryAnalysisRepository implements AnalysisRepository {
  private readonly runs = new Table<AnalysisRun>();
  private readonly findings: Finding[] = [];

  async saveRun(run: AnalysisRun): Promise<void> {
    this.runs.set(run);
  }

  async getRun(id: string): Promise<AnalysisRun | undefined> {
    return this.runs.get(id);
  }

  async listRuns(projectId: string): Promise<AnalysisRun[]> {
    return this.runs.all().filter((r) => r.projectId === projectId);
  }

  async saveFindings(findings: Finding[]): Promise<void> {
    const incoming = new Set(findings.map((f) => f.id));
    const merged = [...this.findings.filter((f) => !incoming.has(f.id)), ...findings];
    this.findings.splice(0, this.findings.length, ...merged);
  }

  async listFindings(projectId: string, analysisId?: string): Promise<Finding[]> {
    return this.findings.filter(
      (f) => f.projectId === projectId && (!analysisId || f.analysisId === analysisId),
    );
  }

  async updateFinding(finding: Finding): Promise<void> {
    const index = this.findings.findIndex((f) => f.id === finding.id);
    if (index < 0) {
      throw new AppError('Finding not found.', { kind: 'not-found', code: 'FINDING_MISSING' });
    }
    this.findings[index] = finding;
  }
}

export class MemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Table<Conversation>();
  private readonly messages: Message[] = [];

  async saveConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation);
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async listConversations(projectId: string): Promise<Conversation[]> {
    return this.conversations
      .all()
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  async removeConversation(id: string): Promise<void> {
    this.conversations.delete(id);
    const kept = this.messages.filter((m) => m.conversationId !== id);
    this.messages.splice(0, this.messages.length, ...kept);
  }

  async appendMessage(message: Message): Promise<void> {
    this.messages.push(message);
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return this.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class MemoryAgentRepository implements AgentRepository {
  private readonly agents = new Table<Agent>();
  private readonly runs = new Table<AgentRun>();

  async saveAgent(agent: Agent): Promise<void> {
    this.agents.set(agent);
  }

  async listAgents(projectId?: string): Promise<Agent[]> {
    return this.agents
      .all()
      .filter((a) => !projectId || a.projectId === null || a.projectId === projectId);
  }

  async saveRun(run: AgentRun): Promise<void> {
    this.runs.set(run);
  }

  async listRuns(projectId: string): Promise<AgentRun[]> {
    return this.runs.all().filter((r) => r.projectId === projectId);
  }
}

export class MemoryPolicyRepository implements PolicyRepository {
  private readonly policies = new Table<Policy>();
  private readonly requests = new Table<PermissionRequest>();

  async savePolicy(policy: Policy): Promise<void> {
    this.policies.set(policy);
  }

  async listPolicies(): Promise<Policy[]> {
    return this.policies.all();
  }

  async saveRequest(request: PermissionRequest): Promise<void> {
    this.requests.set(request);
  }

  async getRequest(id: string): Promise<PermissionRequest | undefined> {
    return this.requests.get(id);
  }

  async listPendingRequests(projectId?: string): Promise<PermissionRequest[]> {
    return this.requests
      .all()
      .filter((r) => r.status === 'pending' && (!projectId || r.projectId === projectId));
  }

  async updateRequest(request: PermissionRequest): Promise<void> {
    requireRow(this.requests, request.id, 'PERMISSION_REQUEST_MISSING');
    this.requests.set(request);
  }
}

export class MemoryChangeRepository implements ChangeRepository {
  private readonly patches = new Table<Patch>();
  private readonly snapshots: Snapshot[] = [];

  async savePatch(patch: Patch): Promise<void> {
    this.patches.set(patch);
  }

  async getPatch(id: string): Promise<Patch | undefined> {
    return this.patches.get(id);
  }

  async listPatches(projectId: string): Promise<Patch[]> {
    return this.patches.all().filter((p) => p.projectId === projectId);
  }

  async updatePatch(patch: Patch): Promise<void> {
    requireRow(this.patches, patch.id, 'PATCH_MISSING');
    this.patches.set(patch);
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    this.snapshots.push(snapshot);
  }

  async listSnapshots(projectId: string): Promise<Snapshot[]> {
    return this.snapshots.filter((s) => s.projectId === projectId);
  }
}

export class MemoryReportRepository implements ReportRepository {
  private readonly reports = new Table<Report>();

  async saveReport(report: Report): Promise<void> {
    this.reports.set(report);
  }

  async listReports(projectId: string): Promise<Report[]> {
    return this.reports.all().filter((r) => r.projectId === projectId);
  }

  async getReport(id: string): Promise<Report | undefined> {
    return this.reports.get(id);
  }
}

export class MemoryAuditRepository implements AuditRepository {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async list(projectId?: string, limit = 500): Promise<AuditEvent[]> {
    return this.events
      .filter((e) => !projectId || e.projectId === projectId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }
}
