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

/** Filesystem capability required by use cases (implemented in infrastructure). */
export interface FileSystemPort {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  move(source: string, destination: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number; modifiedAt: string; isDirectory: boolean }>;
  listDirectory(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

export interface ProjectRepository {
  listWorkspaces(): Promise<Workspace[]>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  saveProject(project: Project): Promise<void>;
  removeProject(id: string): Promise<void>;
}

export interface FileIndexRepository {
  upsertFiles(files: FileNode[]): Promise<void>;
  listFiles(projectId: string): Promise<FileNode[]>;
  removeFiles(projectId: string, paths: string[]): Promise<void>;
  clearProject(projectId: string): Promise<void>;
}

export interface AnalysisRepository {
  saveRun(run: AnalysisRun): Promise<void>;
  getRun(id: string): Promise<AnalysisRun | undefined>;
  listRuns(projectId: string): Promise<AnalysisRun[]>;
  saveFindings(findings: Finding[]): Promise<void>;
  listFindings(projectId: string, analysisId?: string): Promise<Finding[]>;
  updateFinding(finding: Finding): Promise<void>;
}

export interface ConversationRepository {
  saveConversation(conversation: Conversation): Promise<void>;
  getConversation(id: string): Promise<Conversation | undefined>;
  listConversations(projectId: string): Promise<Conversation[]>;
  removeConversation(id: string): Promise<void>;
  appendMessage(message: Message): Promise<void>;
  listMessages(conversationId: string): Promise<Message[]>;
}

export interface AgentRepository {
  saveAgent(agent: Agent): Promise<void>;
  listAgents(projectId?: string): Promise<Agent[]>;
  saveRun(run: AgentRun): Promise<void>;
  listRuns(projectId: string): Promise<AgentRun[]>;
}

export interface PolicyRepository {
  savePolicy(policy: Policy): Promise<void>;
  listPolicies(): Promise<Policy[]>;
  saveRequest(request: PermissionRequest): Promise<void>;
  getRequest(id: string): Promise<PermissionRequest | undefined>;
  listPendingRequests(projectId?: string): Promise<PermissionRequest[]>;
  updateRequest(request: PermissionRequest): Promise<void>;
}

export interface ChangeRepository {
  savePatch(patch: Patch): Promise<void>;
  getPatch(id: string): Promise<Patch | undefined>;
  listPatches(projectId: string): Promise<Patch[]>;
  updatePatch(patch: Patch): Promise<void>;
  saveSnapshot(snapshot: Snapshot): Promise<void>;
  listSnapshots(projectId: string): Promise<Snapshot[]>;
}

export interface ReportRepository {
  saveReport(report: Report): Promise<void>;
  listReports(projectId: string): Promise<Report[]>;
  getReport(id: string): Promise<Report | undefined>;
}

export interface AuditRepository {
  /** Append-only: implementations must reject update/delete. */
  append(event: AuditEvent): Promise<void>;
  list(projectId?: string, limit?: number): Promise<AuditEvent[]>;
}

/** Clock abstraction so use cases are deterministic in tests. */
export interface Clock {
  now(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};
