import type {
  ConversationRepository,
  PolicyRepository,
  ProjectRepository,
} from '@tahlely/application';
import type {
  Conversation,
  Message,
  PermissionRequest,
  Policy,
  Project,
  Workspace,
} from '@tahlely/domain';
import { AppError } from '@tahlely/domain';

const PREFIX = 'tahlely.v1.';
const memoryFallback = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    // Private mode / non-browser runtimes fall through to memory.
  }
  return memoryFallback.get(key) ?? null;
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // Fall through to memory.
  }
  memoryFallback.set(key, value);
}

/** Document store for the webview: localStorage with an in-memory fallback. */
export class WebDocumentStore {
  readAll<T>(collection: string): T[] {
    const raw = storageGet(`${PREFIX}${collection}`);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  writeAll<T>(collection: string, rows: T[]): void {
    storageSet(`${PREFIX}${collection}`, JSON.stringify(rows));
  }
}

export class WebProjectRepository implements ProjectRepository {
  constructor(private readonly store: WebDocumentStore) {}

  async listWorkspaces(): Promise<Workspace[]> {
    return this.store.readAll<Workspace>('workspaces');
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    const rows = await this.listWorkspaces();
    const index = rows.findIndex((row) => row.id === workspace.id);
    if (index >= 0) rows[index] = workspace;
    else rows.push(workspace);
    this.store.writeAll('workspaces', rows);
  }

  async listProjects(): Promise<Project[]> {
    return this.store.readAll<Project>('projects');
  }

  async getProject(id: string): Promise<Project | undefined> {
    return (await this.listProjects()).find((row) => row.id === id);
  }

  async saveProject(project: Project): Promise<void> {
    const rows = await this.listProjects();
    const index = rows.findIndex((row) => row.id === project.id);
    if (index >= 0) rows[index] = project;
    else rows.push(project);
    this.store.writeAll('projects', rows);
  }

  async removeProject(id: string): Promise<void> {
    this.store.writeAll(
      'projects',
      (await this.listProjects()).filter((row) => row.id !== id),
    );
  }
}

export class WebConversationRepository implements ConversationRepository {
  constructor(private readonly store: WebDocumentStore) {}

  async saveConversation(conversation: Conversation): Promise<void> {
    const rows = this.store.readAll<Conversation>('conversations');
    const index = rows.findIndex((row) => row.id === conversation.id);
    if (index >= 0) rows[index] = conversation;
    else rows.push(conversation);
    this.store.writeAll('conversations', rows);
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return this.store.readAll<Conversation>('conversations').find((row) => row.id === id);
  }

  async listConversations(projectId: string): Promise<Conversation[]> {
    return this.store
      .readAll<Conversation>('conversations')
      .filter((row) => row.projectId === projectId)
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  async removeConversation(id: string): Promise<void> {
    this.store.writeAll(
      'conversations',
      this.store.readAll<Conversation>('conversations').filter((row) => row.id !== id),
    );
    this.store.writeAll(
      'messages',
      this.store.readAll<Message>('messages').filter((row) => row.conversationId !== id),
    );
  }

  async appendMessage(message: Message): Promise<void> {
    const rows = this.store.readAll<Message>('messages');
    rows.push(message);
    this.store.writeAll('messages', rows);
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return this.store
      .readAll<Message>('messages')
      .filter((row) => row.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class WebPolicyRepository implements PolicyRepository {
  constructor(private readonly store: WebDocumentStore) {}

  async savePolicy(policy: Policy): Promise<void> {
    const rows = this.store.readAll<Policy>('policies');
    const index = rows.findIndex((row) => row.id === policy.id);
    if (index >= 0) rows[index] = policy;
    else rows.push(policy);
    this.store.writeAll('policies', rows);
  }

  async listPolicies(): Promise<Policy[]> {
    return this.store.readAll<Policy>('policies');
  }

  async saveRequest(request: PermissionRequest): Promise<void> {
    const rows = this.store.readAll<PermissionRequest>('permission-requests');
    rows.push(request);
    this.store.writeAll('permission-requests', rows);
  }

  async getRequest(id: string): Promise<PermissionRequest | undefined> {
    return this.store.readAll<PermissionRequest>('permission-requests').find((r) => r.id === id);
  }

  async listPendingRequests(projectId?: string): Promise<PermissionRequest[]> {
    return this.store
      .readAll<PermissionRequest>('permission-requests')
      .filter((row) => row.status === 'pending' && (!projectId || row.projectId === projectId));
  }

  async updateRequest(request: PermissionRequest): Promise<void> {
    const rows = this.store.readAll<PermissionRequest>('permission-requests');
    const index = rows.findIndex((row) => row.id === request.id);
    if (index < 0) {
      throw new AppError('Permission request not found.', {
        kind: 'not-found',
        code: 'PERMISSION_REQUEST_MISSING',
      });
    }
    rows[index] = request;
    this.store.writeAll('permission-requests', rows);
  }
}
