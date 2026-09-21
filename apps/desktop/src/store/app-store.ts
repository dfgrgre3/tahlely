import { create } from 'zustand';
import type {
  AnalysisMode,
  AnalysisRun,
  Conversation,
  Finding,
  Message,
  PermissionRequest,
  Project,
  ProjectId,
  Report,
  TaskRecord,
} from '@tahlely/domain';
import {
  askAssistant,
  buildAiProjectReport,
  buildProjectReport,
  buildToolProjectReport,
  decideApproval,
  ensureConversation,
  loadDemoProject,
  openFolderProject,
  runProjectAnalysis,
  seedAgents,
  services,
  waitForTask,
} from '../services/bootstrap.js';
import type { Agent } from '@tahlely/domain';
import type { SnippetAnalysisMode } from '../services/file-analyzer.js';
import { analyzeSnippetFile } from '../services/file-analyzer.js';
import type { UploadedFile } from '../services/folder-import.js';
import { importUploadedFolder } from '../services/folder-import.js';
import type { AgentFleetResult } from '../services/bootstrap.js';
import { launchAgentFleet } from '../services/bootstrap.js';

/**
 * UI-only state container. All business logic lives in services/use cases;
 * the store holds view state, mirrors repository snapshots, and forwards
 * user intents. No filesystem, shell, or model calls happen here.
 */
interface AppState {
  projects: Project[];
  activeProjectId?: ProjectId;
  conversations: Conversation[];
  activeConversationId?: string;
  messages: Message[];
  findings: Finding[];
  analyses: AnalysisRun[];
  reports: Report[];
  tasks: TaskRecord[];
  approvals: PermissionRequest[];
  agents: Agent[];
  activity: string[];
  busy: boolean;
  error?: string;

  refresh: () => Promise<void>;
  appendActivity: (line: string) => void;
  selectProject: (id: ProjectId) => Promise<void>;
  openDemo: () => Promise<void>;
  openFolder: (rootPath: string, name: string) => Promise<void>;
  importFolder: (name: string, files: UploadedFile[]) => Promise<void>;
  removeProject: (id: ProjectId) => Promise<void>;
  runAnalysis: (profileId: string, mode: AnalysisMode) => Promise<void>;
  generateReport: (analysisId: string, title: string) => Promise<void>;
  generateAiReport: (analysisId?: string, model?: string) => Promise<void>;
  generateToolReport: (analysisId?: string) => Promise<void>;
  analyzeSnippet: (input: {
    content: string;
    fileName?: string;
    source: 'paste' | 'upload' | 'url';
    mode: SnippetAnalysisMode;
  }) => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  decide: (requestId: string, approve: boolean, note?: string) => Promise<void>;
  refreshTasks: () => void;
  fleetResults: AgentFleetResult[];
  launchFleet: (model?: string) => Promise<void>;
  clearError: () => void;
}

async function snapshotProject(projectId: ProjectId | undefined): Promise<Partial<AppState>> {
  if (!projectId) {
    return { conversations: [], messages: [], findings: [], analyses: [], reports: [] };
  }
  const [conversations, analyses, reports, approvals] = await Promise.all([
    services.conversations.listConversations(projectId),
    services.analyses.listRuns(projectId),
    services.reports.listReports(projectId),
    services.policies.listPendingRequests(projectId),
  ]);
  const activeConversationId = conversations[0]?.id ?? (await ensureConversation(projectId));
  const refreshed = await services.conversations.listConversations(projectId);
  const messages = await services.conversations.listMessages(activeConversationId);
  const latestAnalysis = analyses[analyses.length - 1];
  const findings = latestAnalysis
    ? await services.analyses.listFindings(projectId, latestAnalysis.id)
    : [];
  return {
    conversations: refreshed,
    activeConversationId,
    messages,
    findings,
    analyses,
    reports,
    approvals,
  };
}

export const useAppStore = create<AppState>()((set, get) => ({
  projects: [],
  conversations: [],
  messages: [],
  findings: [],
  analyses: [],
  reports: [],
  tasks: [],
  approvals: [],
  agents: [],
  activity: [],
  busy: false,

  refresh: async () => {
    set({ busy: true, error: undefined });
    try {
      await seedAgents();
      const [projects, agents] = await Promise.all([
        services.projects.listProjects(),
        services.agents.listAgents(),
      ]);
      const activeProjectId = get().activeProjectId ?? projects[0]?.id;
      set({
        projects,
        agents,
        activeProjectId,
        tasks: services.tasks.list(activeProjectId),
        ...(await snapshotProject(activeProjectId)),
        busy: false,
      });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  appendActivity: (line) => {
    const activity = [...get().activity, line].slice(-200);
    set({ activity });
  },

  selectProject: async (id) => {
    set({ activeProjectId: id, busy: true, error: undefined });
    try {
      set({ ...(await snapshotProject(id)), tasks: services.tasks.list(id), busy: false });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  openDemo: async () => {
    set({ busy: true, error: undefined });
    try {
      const project = await loadDemoProject();
      const projects = await services.projects.listProjects();
      set({ projects, activeProjectId: project.id });
      set({ ...(await snapshotProject(project.id)), busy: false });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  openFolder: async (rootPath, name) => {
    set({ busy: true, error: undefined });
    try {
      const project = await openFolderProject(rootPath, name);
      const projects = await services.projects.listProjects();
      set({ projects, activeProjectId: project.id });
      set({ ...(await snapshotProject(project.id)), busy: false });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  importFolder: async (name, files) => {
    set({ busy: true, error: undefined });
    try {
      const project = await importUploadedFolder(name, files);
      // Auto full analysis right after import (per product flow).
      const task = await runProjectAnalysis(project.id, 'comprehensive', 'tool-only', () => {
        set({ tasks: services.tasks.list(project.id) });
      });
      await waitForTask(task.id);
      const projects = await services.projects.listProjects();
      set({ projects, activeProjectId: project.id, ...(await snapshotProject(project.id)) });
      set({ busy: false, tasks: services.tasks.list(project.id) });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  removeProject: async (id) => {
    await services.projects.removeProject(id);
    const projects = await services.projects.listProjects();
    const activeProjectId = projects[0]?.id;
    set({ projects, activeProjectId });
    set(await snapshotProject(activeProjectId));
  },

  runAnalysis: async (profileId, mode) => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    set({ busy: true, error: undefined });
    try {
      const task = await runProjectAnalysis(activeProjectId, profileId, mode, () => {
        set({ tasks: services.tasks.list(activeProjectId) });
      });
      await waitForTask(task.id);
      const analyses = await services.analyses.listRuns(activeProjectId);
      const latest = analyses[analyses.length - 1];
      const findings = latest
        ? await services.analyses.listFindings(activeProjectId, latest.id)
        : [];
      set({
        analyses,
        findings,
        tasks: services.tasks.list(activeProjectId),
        busy: false,
      });
    } catch (error) {
      set({
        busy: false,
        tasks: services.tasks.list(activeProjectId),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  generateReport: async (analysisId, title) => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    set({ busy: true, error: undefined });
    try {
      await buildProjectReport(activeProjectId, analysisId, title);
      const reports = await services.reports.listReports(activeProjectId);
      set({ reports, busy: false });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  generateToolReport: async (analysisId) => {
    const { activeProjectId, activeConversationId } = get();
    if (!activeProjectId) return;
    set({ busy: true, error: undefined });
    try {
      await buildToolProjectReport(activeProjectId, {
        analysisId,
        conversationId: activeConversationId,
      });
      const reports = await services.reports.listReports(activeProjectId);
      set({ reports, busy: false });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  generateAiReport: async (analysisId, model) => {
    const { activeProjectId, activeConversationId } = get();
    if (!activeProjectId) return;
    set({ busy: true, error: undefined });
    try {
      await buildAiProjectReport(activeProjectId, {
        analysisId,
        model,
        conversationId: activeConversationId,
      });
      const reports = await services.reports.listReports(activeProjectId);
      set({ reports, busy: false });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  analyzeSnippet: async (input) => {
    const { activeProjectId, activeConversationId } = get();
    if (!activeProjectId) return;
    set({ busy: true, error: undefined });
    try {
      const { conversationId } = await analyzeSnippetFile({
        projectId: activeProjectId,
        conversationId: activeConversationId,
        ...input,
      });
      const [reports, conversations] = await Promise.all([
        services.reports.listReports(activeProjectId),
        services.conversations.listConversations(activeProjectId),
      ]);
      set({ reports, conversations, activeConversationId: conversationId, busy: false });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  selectConversation: async (id) => {
    set({ activeConversationId: id });
    const messages = await services.conversations.listMessages(id);
    set({ messages });
  },

  deleteConversation: async (id) => {
    const { activeProjectId, activeConversationId } = get();
    await services.conversations.removeConversation(id);
    if (!activeProjectId) return;
    const conversations = await services.conversations.listConversations(activeProjectId);
    const nextId =
      activeConversationId === id ? (conversations[0]?.id ?? (await ensureConversation(activeProjectId))) : (activeConversationId ?? conversations[0]?.id);
    const finalList = await services.conversations.listConversations(activeProjectId);
    const messages = nextId ? await services.conversations.listMessages(nextId) : [];
    set({ conversations: finalList, activeConversationId: nextId, messages });
  },

  newConversation: async () => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    const { createConversation } = await import('@tahlely/application');
    const { MemoryFileSystem } = await import('@tahlely/infrastructure');
    const conversation = await createConversation(
      {
        projects: services.projects,
        conversations: services.conversations,
        analyses: services.analyses,
        policies: services.policies,
        changes: services.changes,
        audit: services.audit,
        fs: new MemoryFileSystem(),
        events: services.bus,
      },
      { projectId: activeProjectId },
    );
    const conversations = await services.conversations.listConversations(activeProjectId);
    set({ conversations, activeConversationId: conversation.id, messages: [] });
  },

  sendMessage: async (text) => {
    const { activeConversationId } = get();
    if (!activeConversationId || !text.trim()) return;
    set({ busy: true, error: undefined });
    try {
      await askAssistant(activeConversationId, text);
      const messages = await services.conversations.listMessages(activeConversationId);
      set({ messages, busy: false });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  decide: async (requestId, approve, note) => {
    const { activeProjectId } = get();
    set({ error: undefined });
    try {
      await decideApproval(requestId, approve, note);
      const approvals = activeProjectId
        ? await services.policies.listPendingRequests(activeProjectId)
        : [];
      set({ approvals });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  refreshTasks: () => {
    const { activeProjectId } = get();
    set({ tasks: services.tasks.list(activeProjectId) });
  },

  clearError: () => set({ error: undefined }),

  fleetResults: [],

  launchFleet: async (model) => {
    const { activeProjectId, activeConversationId } = get();
    if (!activeProjectId) return;
    set({ fleetResults: [], error: undefined });
    const final = await launchAgentFleet(activeProjectId, {
      model,
      conversationId: activeConversationId,
      onAgentDone: (result) => {
        set({ fleetResults: [...get().fleetResults, result] });
      },
    });
    set({ fleetResults: final });
  },
}));
