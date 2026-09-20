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
import type { FileIndexRepository } from '@tahlely/application';
import {
  JsonAgentRepository,
  JsonAnalysisRepository,
  JsonAuditRepository,
  JsonChangeRepository,
  JsonConversationRepository,
  JsonDocumentStore,
  JsonFileIndexRepository,
  JsonPolicyRepository,
  JsonProjectRepository,
  JsonReportRepository,
} from './json-repositories.js';
import { dataDirLayout } from './schema.js';

export { dataDirLayout };

export interface Repositories {
  projects: ProjectRepository;
  fileIndex: FileIndexRepository;
  analyses: AnalysisRepository;
  conversations: ConversationRepository;
  agents: AgentRepository;
  policies: PolicyRepository;
  changes: ChangeRepository;
  reports: ReportRepository;
  audit: AuditRepository;
}

/** Prompt-1 factory: JSON-file repositories. SQLite factory replaces this. */
export function createRepositories(dataDir: string): Repositories {
  const store = new JsonDocumentStore(dataDir);
  return {
    projects: new JsonProjectRepository(store),
    fileIndex: new JsonFileIndexRepository(store),
    analyses: new JsonAnalysisRepository(store),
    conversations: new JsonConversationRepository(store),
    agents: new JsonAgentRepository(store),
    policies: new JsonPolicyRepository(store),
    changes: new JsonChangeRepository(store),
    reports: new JsonReportRepository(store),
    audit: new JsonAuditRepository(store),
  };
}
