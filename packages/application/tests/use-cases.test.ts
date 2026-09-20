import { describe, expect, it } from 'vitest';
import {
  createConversation,
  decidePermission,
  openProject,
  postMessage,
  recordPatch,
  requestPermission,
  startAnalysis,
} from '@tahlely/application';
import type {
  AnalysisRepository,
  AuditRepository,
  ChangeRepository,
  ConversationRepository,
  FileSystemPort,
  PolicyRepository,
  ProjectRepository,
  ServiceContext,
} from '@tahlely/application';
import { EventBus } from '@tahlely/application';
import type {
  AnalysisRun,
  AuditEvent,
  Conversation,
  Finding,
  Message,
  Patch,
  PermissionRequest,
  Policy,
  Project,
  Snapshot,
} from '@tahlely/domain';

const stubFs: FileSystemPort = {
  readTextFile: async () => '',
  writeTextFile: async () => {},
  createFile: async () => {},
  rename: async () => {},
  move: async () => {},
  deletePath: async () => {},
  stat: async () => ({ size: 0, modifiedAt: new Date(0).toISOString(), isDirectory: false }),
  listDirectory: async () => [],
  exists: async () => true,
};

function memoryContext(): ServiceContext {
  const projects = new Map<string, Project>();
  const conversations = new Map<string, Conversation>();
  const messages: Message[] = [];
  const runs = new Map<string, AnalysisRun>();
  const requests = new Map<string, PermissionRequest>();
  const patches = new Map<string, Patch>();
  const events: AuditEvent[] = [];

  const projectRepo: ProjectRepository = {
    listWorkspaces: async () => [],
    saveWorkspace: async () => {},
    listProjects: async () => [...projects.values()],
    getProject: async (id) => projects.get(id),
    saveProject: async (project) => {
      projects.set(project.id, project);
    },
    removeProject: async (id) => {
      projects.delete(id);
    },
  };
  const conversationRepo: ConversationRepository = {
    saveConversation: async (conversation) => {
      conversations.set(conversation.id, conversation);
    },
    getConversation: async (id) => conversations.get(id),
    listConversations: async (projectId) =>
      [...conversations.values()].filter((c) => c.projectId === projectId),
    removeConversation: async (id) => {
      conversations.delete(id);
    },
    appendMessage: async (message) => {
      messages.push(message);
    },
    listMessages: async (conversationId) =>
      messages.filter((m) => m.conversationId === conversationId),
  };
  const analysisRepo: AnalysisRepository = {
    saveRun: async (run) => {
      runs.set(run.id, run);
    },
    getRun: async (id) => runs.get(id),
    listRuns: async (projectId) => [...runs.values()].filter((r) => r.projectId === projectId),
    saveFindings: async () => {},
    listFindings: async () => [] as Finding[],
    updateFinding: async () => {},
  };
  const policyRepo: PolicyRepository = {
    savePolicy: async () => {},
    listPolicies: async () => [] as Policy[],
    saveRequest: async (request) => {
      requests.set(request.id, request);
    },
    getRequest: async (id) => requests.get(id),
    listPendingRequests: async () => [...requests.values()].filter((r) => r.status === 'pending'),
    updateRequest: async (request) => {
      requests.set(request.id, request);
    },
  };
  const changeRepo: ChangeRepository = {
    savePatch: async (patch) => {
      patches.set(patch.id, patch);
    },
    getPatch: async (id) => patches.get(id),
    listPatches: async (projectId) =>
      [...patches.values()].filter((p) => p.projectId === projectId),
    updatePatch: async (patch) => {
      patches.set(patch.id, patch);
    },
    saveSnapshot: async () => {},
    listSnapshots: async () => [] as Snapshot[],
  };
  const auditRepo: AuditRepository = {
    append: async (event) => {
      events.push(event);
    },
    list: async () => events,
  };
  return {
    projects: projectRepo,
    conversations: conversationRepo,
    analyses: analysisRepo,
    policies: policyRepo,
    changes: changeRepo,
    audit: auditRepo,
    fs: stubFs,
    events: new EventBus(),
  };
}

describe('use cases', () => {
  it('opens a project and emits ProjectOpened', async () => {
    const ctx = memoryContext();
    const seen: string[] = [];
    ctx.events.on('ProjectOpened', (event) => {
      seen.push(event.payload.rootPath);
    });
    const project = await openProject(ctx, { name: 'demo', rootPath: 'D:/repo' });
    expect(project.name).toBe('demo');
    expect(seen).toEqual(['D:/repo']);
  });

  it('creates conversations and posts messages with counts', async () => {
    const ctx = memoryContext();
    const project = await openProject(ctx, { name: 'demo', rootPath: 'D:/repo' });
    const conversation = await createConversation(ctx, { projectId: project.id });
    await postMessage(ctx, { conversationId: conversation.id, role: 'user', body: 'hello' });
    const stored = await ctx.conversations.getConversation(conversation.id);
    expect(stored?.messageCount).toBe(1);
    await expect(
      postMessage(ctx, { conversationId: conversation.id, role: 'user', body: '   ' }),
    ).rejects.toThrow();
  });

  it('starts analyses in queued state and emits AnalysisStarted', async () => {
    const ctx = memoryContext();
    const project = await openProject(ctx, { name: 'demo', rootPath: 'D:/repo' });
    const run = await startAnalysis(ctx, {
      projectId: project.id,
      mode: 'tool-only',
      profileId: 'quick',
      analyzers: ['syntax'],
      targetPaths: [],
    });
    expect(run.status).toBe('queued');
    expect(run.mode).toBe('tool-only');
  });

  it('requests and decides permissions with an audit trail', async () => {
    const ctx = memoryContext();
    const project = await openProject(ctx, { name: 'demo', rootPath: 'D:/repo' });
    const request = await requestPermission(ctx, {
      projectId: project.id,
      permission: 'WRITE_FILE',
      action: 'Apply refactor patch',
      target: 'src/a.ts',
    });
    expect(request.status).toBe('pending');
    const decided = await decidePermission(ctx, { requestId: request.id, approve: true });
    expect(decided.status).toBe('approved');
    expect(await ctx.audit.list()).toHaveLength(1);
    await expect(decidePermission(ctx, { requestId: request.id, approve: true })).rejects.toThrow();
  });

  it('records patches as proposals (never applies)', async () => {
    const ctx = memoryContext();
    const project = await openProject(ctx, { name: 'demo', rootPath: 'D:/repo' });
    const patch = await recordPatch(ctx, {
      projectId: project.id,
      targetPath: 'src/a.ts',
      newText: 'const x = 1;\n',
      risk: 'low',
    });
    expect(patch.status).toBe('proposed');
  });
});
