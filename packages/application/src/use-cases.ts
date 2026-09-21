import type {
  AnalysisMode,
  AnalysisRun,
  AnalyzerKind,
  Conversation,
  ConversationId,
  Message,
  MessageRole,
  Patch,
  Permission,
  PermissionRequest,
  Project,
  ProjectId,
  Snapshot,
} from '@tahlely/domain';
import { AppError, newId, utcNow } from '@tahlely/domain';
import type { EventBus } from './event-bus.js';
import type {
  AnalysisRepository,
  AuditRepository,
  ChangeRepository,
  Clock,
  ConversationRepository,
  FileSystemPort,
  PolicyRepository,
  ProjectRepository,
} from './ports.js';
import { systemClock } from './ports.js';

export interface ServiceContext {
  projects: ProjectRepository;
  conversations: ConversationRepository;
  analyses: AnalysisRepository;
  policies: PolicyRepository;
  changes: ChangeRepository;
  audit: AuditRepository;
  fs: FileSystemPort;
  events: EventBus;
  clock?: Clock;
}

function clockOf(ctx: ServiceContext): Clock {
  return ctx.clock ?? systemClock;
}

/** OpenProject — register (or re-register) a local folder as a project. */
export async function openProject(
  ctx: ServiceContext,
  input: { name: string; rootPath: string },
): Promise<Project> {
  const normalized = input.rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized.includes('..')) {
    throw new AppError('Invalid project path.', { kind: 'validation', code: 'PROJECT_BAD_PATH' });
  }
  const exists = await ctx.fs.exists(normalized);
  if (!exists) {
    throw new AppError(`Project path does not exist: ${normalized}`, {
      kind: 'not-found',
      code: 'PROJECT_PATH_MISSING',
    });
  }
  const now = clockOf(ctx).now();
  const project: Project = {
    id: newId('prj'),
    name: input.name,
    rootPath: normalized,
    kind: 'unknown',
    languages: [],
    frameworks: [],
    packageManagers: [],
    entryPoints: [],
    settings: { ignoredPaths: [], enableLocalIndex: true },
    createdAt: now,
    updatedAt: now,
  };
  await ctx.projects.saveProject(project);
  await ctx.events.emit(
    'ProjectOpened',
    { projectId: project.id, rootPath: project.rootPath },
    project.id,
  );
  return project;
}

/** CreateConversation — a persistent project workspace, not a bare transcript. */
export async function createConversation(
  ctx: ServiceContext,
  input: { projectId: ProjectId; title?: string },
): Promise<Conversation> {
  const project = await ctx.projects.getProject(input.projectId);
  if (!project) {
    throw new AppError('Project not found.', { kind: 'not-found', code: 'PROJECT_MISSING' });
  }
  const now = clockOf(ctx).now();
  const existing = await ctx.conversations.listConversations(input.projectId);
  const conversation: Conversation = {
    id: newId('conv'),
    projectId: input.projectId,
    title: input.title ?? `Conversation ${existing.length + 1}`,
    status: 'active',
    messageCount: 0,
    lastActiveAt: now,
    activeAgentIds: [],
    pinnedFilePaths: [],
    createdAt: now,
    updatedAt: now,
  };
  await ctx.conversations.saveConversation(conversation);
  return conversation;
}

export async function postMessage(
  ctx: ServiceContext,
  input: { conversationId: ConversationId; role: MessageRole; body: string },
): Promise<Message> {
  if (!input.body.trim()) {
    throw new AppError('Message body must not be empty.', {
      kind: 'validation',
      code: 'MESSAGE_EMPTY',
    });
  }
  const conversation = await ctx.conversations.getConversation(input.conversationId);
  if (!conversation) {
    throw new AppError('Conversation not found.', {
      kind: 'not-found',
      code: 'CONVERSATION_MISSING',
    });
  }
  const now = clockOf(ctx).now();
  const message: Message = {
    id: newId('msg'),
    conversationId: input.conversationId,
    role: input.role,
    body: input.body,
    attachments: [],
    analysisIds: [],
    reportIds: [],
    agentRunIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await ctx.conversations.appendMessage(message);
  await ctx.conversations.saveConversation({
    ...conversation,
    messageCount: conversation.messageCount + 1,
    lastActiveAt: now,
    updatedAt: now,
  });
  return message;
}

/** StartAnalysis — creates the run record; execution is driven by the engine. */
export async function startAnalysis(
  ctx: ServiceContext,
  input: {
    projectId: ProjectId;
    conversationId?: ConversationId;
    mode: AnalysisMode;
    profileId: string;
    analyzers: AnalyzerKind[];
    targetPaths: string[];
  },
): Promise<AnalysisRun> {
  const project = await ctx.projects.getProject(input.projectId);
  if (!project) {
    throw new AppError('Project not found.', { kind: 'not-found', code: 'PROJECT_MISSING' });
  }
  const now = clockOf(ctx).now();
  const run: AnalysisRun = {
    id: newId('anl'),
    projectId: input.projectId,
    conversationId: input.conversationId,
    mode: input.mode,
    profileId: input.profileId,
    analyzerIds: input.analyzers,
    targetPaths: input.targetPaths,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  await ctx.analyses.saveRun(run);
  await ctx.events.emit(
    'AnalysisStarted',
    { analysisId: run.id, projectId: run.projectId },
    run.projectId,
  );
  return run;
}

/**
 * RequestPermission — the ONLY path for agents to obtain sensitive rights.
 * Creates a pending request and notifies the Approvals surface via events.
 */
export async function requestPermission(
  ctx: ServiceContext,
  input: {
    projectId: ProjectId;
    agentId?: string;
    permission: Permission;
    action: string;
    target?: string;
    reason?: string;
  },
): Promise<PermissionRequest> {
  const now = clockOf(ctx).now();
  const request: PermissionRequest = {
    id: newId('perm'),
    projectId: input.projectId,
    agentId: input.agentId as PermissionRequest['agentId'],
    permission: input.permission,
    action: input.action,
    target: input.target,
    reason: input.reason,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await ctx.policies.saveRequest(request);
  await ctx.events.emit(
    'PermissionRequested',
    { requestId: request.id, projectId: request.projectId, permission: request.permission },
    request.projectId,
  );
  return request;
}

export async function decidePermission(
  ctx: ServiceContext,
  input: { requestId: string; approve: boolean; actor?: string; note?: string },
): Promise<PermissionRequest> {
  const request = await ctx.policies.getRequest(input.requestId);
  if (!request) {
    throw new AppError('Permission request not found.', {
      kind: 'not-found',
      code: 'PERMISSION_REQUEST_MISSING',
    });
  }
  if (request.status !== 'pending') {
    throw new AppError(`Request is already ${request.status}.`, {
      kind: 'conflict',
      code: 'PERMISSION_REQUEST_DECIDED',
    });
  }
  const now = clockOf(ctx).now();
  const decided: PermissionRequest = {
    ...request,
    status: input.approve ? 'approved' : 'rejected',
    decidedAt: now,
    decisionNote: input.note,
    updatedAt: now,
  };
  await ctx.policies.updateRequest(decided);
  await ctx.audit.append({
    id: newId('audit'),
    projectId: request.projectId,
    category: 'security',
    action: input.approve ? 'permission.approved' : 'permission.rejected',
    actor: input.actor ?? 'user',
    target: request.target,
    metadata: { requestId: request.id, permission: request.permission, note: input.note },
    at: now,
  });
  await ctx.events.emit(
    input.approve ? 'PermissionApproved' : 'PermissionRejected',
    { requestId: request.id, projectId: request.projectId },
    request.projectId,
  );
  return decided;
}

/** RecordPatch — stage a reversible proposal (application never edits files). */
export async function recordPatch(
  ctx: ServiceContext,
  patch: Omit<Patch, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
): Promise<Patch> {
  const now = clockOf(ctx).now();
  const full: Patch = {
    ...patch,
    id: newId('patch'),
    status: 'proposed',
    createdAt: now,
    updatedAt: now,
  };
  await ctx.changes.savePatch(full);
  await ctx.events.emit(
    'PatchCreated',
    { patchId: full.id, projectId: full.projectId, targetPath: full.targetPath },
    full.projectId,
  );
  return full;
}

/** RecordSnapshot — capture pre-modification state for rollback. */
export async function recordSnapshot(
  ctx: ServiceContext,
  input: Omit<Snapshot, 'id' | 'createdAt'>,
): Promise<Snapshot> {
  const snapshot: Snapshot = { ...input, id: newId('snap'), createdAt: clockOf(ctx).now() };
  await ctx.changes.saveSnapshot(snapshot);
  await ctx.events.emit(
    'SnapshotCreated',
    { snapshotId: snapshot.id, projectId: snapshot.projectId },
    snapshot.projectId,
  );
  return snapshot;
}

export { utcNow };
