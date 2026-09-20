import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import type {
  AgentRepository,
  AnalysisRepository,
  AuditRepository,
  ChangeRepository,
  ConversationRepository,
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
import type { FileIndexRepository } from '@tahlely/application';

/**
 * File-backed repositories (Prompt 1 persistence). Every collection is one
 * JSON document under <dataDir>/<collection>.json, written atomically
 * (temp file + rename). The interfaces are storage-agnostic: the SQLite
 * implementation (docs/adr/004) will implement the same ports without
 * touching callers. Source files are NEVER copied here — only metadata.
 */
export class JsonDocumentStore {
  constructor(private readonly dataDir: string) {}

  private filePath(collection: string): string {
    return nodePath.join(this.dataDir, `${collection}.json`);
  }

  async readAll<T>(collection: string): Promise<T[]> {
    try {
      const raw = await fs.readFile(this.filePath(collection), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return [];
      throw new AppError(`Storage read failed for ${collection}.`, {
        kind: 'database',
        code: 'DB_READ_FAILED',
        cause: error,
      });
    }
  }

  async writeAll<T>(collection: string, rows: T[]): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const temp = `${this.filePath(collection)}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(rows, null, 2), 'utf8');
      await fs.rename(temp, this.filePath(collection));
    } catch (error) {
      throw new AppError(`Storage write failed for ${collection}.`, {
        kind: 'database',
        code: 'DB_WRITE_FAILED',
        cause: error,
      });
    }
  }
}

function byId<T extends { id: string }>(rows: T[], id: string): T | undefined {
  return rows.find((row) => row.id === id);
}

export class JsonProjectRepository implements ProjectRepository {
  constructor(private readonly store: JsonDocumentStore) {}

  async listWorkspaces(): Promise<Workspace[]> {
    return this.store.readAll<Workspace>('workspaces');
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    const rows = await this.listWorkspaces();
    const index = rows.findIndex((row) => row.id === workspace.id);
    if (index >= 0) rows[index] = workspace;
    else rows.push(workspace);
    await this.store.writeAll('workspaces', rows);
  }

  async listProjects(): Promise<Project[]> {
    return this.store.readAll<Project>('projects');
  }

  async getProject(id: string): Promise<Project | undefined> {
    return byId(await this.listProjects(), id);
  }

  async saveProject(project: Project): Promise<void> {
    const rows = await this.listProjects();
    const index = rows.findIndex((row) => row.id === project.id);
    if (index >= 0) rows[index] = project;
    else rows.push(project);
    await this.store.writeAll('projects', rows);
  }

  async removeProject(id: string): Promise<void> {
    const rows = (await this.listProjects()).filter((row) => row.id !== id);
    await this.store.writeAll('projects', rows);
  }
}

export class JsonFileIndexRepository implements FileIndexRepository {
  constructor(private readonly store: JsonDocumentStore) {}

  private async read(): Promise<FileNode[]> {
    return this.store.readAll<FileNode>('file-index');
  }

  async upsertFiles(files: FileNode[]): Promise<void> {
    const rows = await this.read();
    const byPath = new Map(rows.map((row) => [`${row.projectId}::${row.path}`, row]));
    for (const file of files) byPath.set(`${file.projectId}::${file.path}`, file);
    await this.store.writeAll('file-index', [...byPath.values()]);
  }

  async listFiles(projectId: string): Promise<FileNode[]> {
    return (await this.read()).filter((row) => row.projectId === projectId);
  }

  async removeFiles(projectId: string, paths: string[]): Promise<void> {
    const doomed = new Set(paths);
    const rows = (await this.read()).filter(
      (row) => row.projectId !== projectId || !doomed.has(row.path),
    );
    await this.store.writeAll('file-index', rows);
  }

  async clearProject(projectId: string): Promise<void> {
    const rows = (await this.read()).filter((row) => row.projectId !== projectId);
    await this.store.writeAll('file-index', rows);
  }
}

export class JsonAnalysisRepository implements AnalysisRepository {
  constructor(private readonly store: JsonDocumentStore) {}

  async saveRun(run: AnalysisRun): Promise<void> {
    const rows = await this.store.readAll<AnalysisRun>('analysis-runs');
    const index = rows.findIndex((row) => row.id === run.id);
    if (index >= 0) rows[index] = run;
    else rows.push(run);
    await this.store.writeAll('analysis-runs', rows);
  }

  async getRun(id: string): Promise<AnalysisRun | undefined> {
    return byId(await this.store.readAll<AnalysisRun>('analysis-runs'), id);
  }

  async listRuns(projectId: string): Promise<AnalysisRun[]> {
    return (await this.store.readAll<AnalysisRun>('analysis-runs')).filter(
      (row) => row.projectId === projectId,
    );
  }

  async saveFindings(findings: Finding[]): Promise<void> {
    const rows = await this.store.readAll<Finding>('findings');
    const incoming = new Set(findings.map((finding) => finding.id));
    const merged = [...rows.filter((row) => !incoming.has(row.id)), ...findings];
    await this.store.writeAll('findings', merged);
  }

  async listFindings(projectId: string, analysisId?: string): Promise<Finding[]> {
    return (await this.store.readAll<Finding>('findings')).filter(
      (row) => row.projectId === projectId && (!analysisId || row.analysisId === analysisId),
    );
  }

  async updateFinding(finding: Finding): Promise<void> {
    const rows = await this.store.readAll<Finding>('findings');
    const index = rows.findIndex((row) => row.id === finding.id);
    if (index < 0) {
      throw new AppError('Finding not found.', { kind: 'not-found', code: 'FINDING_MISSING' });
    }
    rows[index] = finding;
    await this.store.writeAll('findings', rows);
  }
}

export class JsonConversationRepository implements ConversationRepository {
  constructor(private readonly store: JsonDocumentStore) {}

  async saveConversation(conversation: Conversation): Promise<void> {
    const rows = await this.store.readAll<Conversation>('conversations');
    const index = rows.findIndex((row) => row.id === conversation.id);
    if (index >= 0) rows[index] = conversation;
    else rows.push(conversation);
    await this.store.writeAll('conversations', rows);
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return byId(await this.store.readAll<Conversation>('conversations'), id);
  }

  async listConversations(projectId: string): Promise<Conversation[]> {
    return (await this.store.readAll<Conversation>('conversations'))
      .filter((row) => row.projectId === projectId)
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  async removeConversation(id: string): Promise<void> {
    await this.store.writeAll(
      'conversations',
      (await this.store.readAll<Conversation>('conversations')).filter((row) => row.id !== id),
    );
    await this.store.writeAll(
      'messages',
      (await this.store.readAll<Message>('messages')).filter((row) => row.conversationId !== id),
    );
  }

  async appendMessage(message: Message): Promise<void> {
    const rows = await this.store.readAll<Message>('messages');
    rows.push(message);
    await this.store.writeAll('messages', rows);
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return (await this.store.readAll<Message>('messages'))
      .filter((row) => row.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class JsonAgentRepository implements AgentRepository {
  constructor(private readonly store: JsonDocumentStore) {}

  async saveAgent(agent: Agent): Promise<void> {
    const rows = await this.store.readAll<Agent>('agents');
    const index = rows.findIndex((row) => row.id === agent.id);
    if (index >= 0) rows[index] = agent;
    else rows.push(agent);
    await this.store.writeAll('agents', rows);
  }

  async listAgents(projectId?: string): Promise<Agent[]> {
    return (await this.store.readAll<Agent>('agents')).filter(
      (row) => !projectId || row.projectId === null || row.projectId === projectId,
    );
  }

  async saveRun(run: AgentRun): Promise<void> {
    const rows = await this.store.readAll<AgentRun>('agent-runs');
    const index = rows.findIndex((row) => row.id === run.id);
    if (index >= 0) rows[index] = run;
    else rows.push(run);
    await this.store.writeAll('agent-runs', rows);
  }

  async listRuns(projectId: string): Promise<AgentRun[]> {
    return (await this.store.readAll<AgentRun>('agent-runs')).filter(
      (row) => row.projectId === projectId,
    );
  }
}

export class JsonPolicyRepository implements PolicyRepository {
  constructor(private readonly store: JsonDocumentStore) {}

  async savePolicy(policy: Policy): Promise<void> {
    const rows = await this.store.readAll<Policy>('policies');
    const index = rows.findIndex((row) => row.id === policy.id);
    if (index >= 0) rows[index] = policy;
    else rows.push(policy);
    await this.store.writeAll('policies', rows);
  }

  async listPolicies(): Promise<Policy[]> {
    return this.store.readAll<Policy>('policies');
  }

  async saveRequest(request: PermissionRequest): Promise<void> {
    const rows = await this.store.readAll<PermissionRequest>('permission-requests');
    rows.push(request);
    await this.store.writeAll('permission-requests', rows);
  }

  async getRequest(id: string): Promise<PermissionRequest | undefined> {
    return byId(await this.store.readAll<PermissionRequest>('permission-requests'), id);
  }

  async listPendingRequests(projectId?: string): Promise<PermissionRequest[]> {
    return (await this.store.readAll<PermissionRequest>('permission-requests')).filter(
      (row) => row.status === 'pending' && (!projectId || row.projectId === projectId),
    );
  }

  async updateRequest(request: PermissionRequest): Promise<void> {
    const rows = await this.store.readAll<PermissionRequest>('permission-requests');
    const index = rows.findIndex((row) => row.id === request.id);
    if (index < 0) {
      throw new AppError('Permission request not found.', {
        kind: 'not-found',
        code: 'PERMISSION_REQUEST_MISSING',
      });
    }
    rows[index] = request;
    await this.store.writeAll('permission-requests', rows);
  }
}

export class JsonChangeRepository implements ChangeRepository {
  constructor(private readonly store: JsonDocumentStore) {}

  async savePatch(patch: Patch): Promise<void> {
    const rows = await this.store.readAll<Patch>('patches');
    rows.push(patch);
    await this.store.writeAll('patches', rows);
  }

  async getPatch(id: string): Promise<Patch | undefined> {
    return byId(await this.store.readAll<Patch>('patches'), id);
  }

  async listPatches(projectId: string): Promise<Patch[]> {
    return (await this.store.readAll<Patch>('patches')).filter(
      (row) => row.projectId === projectId,
    );
  }

  async updatePatch(patch: Patch): Promise<void> {
    const rows = await this.store.readAll<Patch>('patches');
    const index = rows.findIndex((row) => row.id === patch.id);
    if (index < 0) {
      throw new AppError('Patch not found.', { kind: 'not-found', code: 'PATCH_MISSING' });
    }
    rows[index] = patch;
    await this.store.writeAll('patches', rows);
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    const rows = await this.store.readAll<Snapshot>('snapshots');
    rows.push(snapshot);
    await this.store.writeAll('snapshots', rows);
  }

  async listSnapshots(projectId: string): Promise<Snapshot[]> {
    return (await this.store.readAll<Snapshot>('snapshots')).filter(
      (row) => row.projectId === projectId,
    );
  }
}

export class JsonReportRepository implements ReportRepository {
  constructor(private readonly store: JsonDocumentStore) {}

  async saveReport(report: Report): Promise<void> {
    const rows = await this.store.readAll<Report>('reports');
    const index = rows.findIndex((row) => row.id === report.id);
    if (index >= 0) rows[index] = report;
    else rows.push(report);
    await this.store.writeAll('reports', rows);
  }

  async listReports(projectId: string): Promise<Report[]> {
    return (await this.store.readAll<Report>('reports')).filter(
      (row) => row.projectId === projectId,
    );
  }

  async getReport(id: string): Promise<Report | undefined> {
    return byId(await this.store.readAll<Report>('reports'), id);
  }
}

export class JsonAuditRepository implements AuditRepository {
  constructor(private readonly store: JsonDocumentStore) {}

  async append(event: AuditEvent): Promise<void> {
    const rows = await this.store.readAll<AuditEvent>('audit');
    rows.push(event);
    await this.store.writeAll('audit', rows);
  }

  async list(projectId?: string, limit = 500): Promise<AuditEvent[]> {
    const rows = (await this.store.readAll<AuditEvent>('audit'))
      .filter((row) => !projectId || row.projectId === projectId)
      .sort((a, b) => b.at.localeCompare(a.at));
    return rows.slice(0, limit);
  }
}
