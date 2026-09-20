/**
 * SQLite schema (target persistence, ADR-004). Prompt 1 ships the JSON-file
 * repositories implementing the same application ports; this DDL is the
 * migration target so the SQLite implementation can land without changing
 * callers. Source files are never stored — only metadata and references.
 */
export const SCHEMA_VERSION = 1;

/** Application data layout: <dataDir>/*.json (one document per collection). */
export function dataDirLayout(dataDir: string): { dataDir: string; collections: string[] } {
  return {
    dataDir,
    collections: [
      'workspaces',
      'projects',
      'file-index',
      'analysis-runs',
      'findings',
      'conversations',
      'messages',
      'agents',
      'agent-runs',
      'policies',
      'permission-requests',
      'patches',
      'snapshots',
      'reports',
      'audit',
    ],
  };
}

export const SQLITE_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'unknown',
  languages TEXT NOT NULL DEFAULT '[]',
  frameworks TEXT NOT NULL DEFAULT '[]',
  package_managers TEXT NOT NULL DEFAULT '[]',
  entry_points TEXT NOT NULL DEFAULT '[]',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  name TEXT NOT NULL,
  extension TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'unknown',
  size INTEGER NOT NULL DEFAULT 0,
  hash TEXT,
  modified_at TEXT,
  ignored INTEGER NOT NULL DEFAULT 0,
  generated INTEGER NOT NULL DEFAULT 0,
  binary INTEGER NOT NULL DEFAULT 0,
  analyzed INTEGER NOT NULL DEFAULT 0,
  importance REAL NOT NULL DEFAULT 0,
  risk REAL NOT NULL DEFAULT 0,
  UNIQUE(project_id, path)
);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT,
  mode TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  analyzer_ids TEXT NOT NULL DEFAULT '[]',
  target_paths TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  summary TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL,
  file_id TEXT,
  path TEXT,
  line INTEGER,
  column INTEGER,
  end_line INTEGER,
  end_column INTEGER,
  category TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  impact TEXT,
  severity TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  recommendation TEXT,
  suggested_fix TEXT,
  related_files TEXT NOT NULL DEFAULT '[]',
  related_symbols TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id);
CREATE INDEX IF NOT EXISTS idx_findings_analysis ON findings(analysis_id);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  message_count INTEGER NOT NULL DEFAULT 0,
  last_active_at TEXT NOT NULL,
  active_agent_ids TEXT NOT NULL DEFAULT '[]',
  pinned_file_paths TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  analysis_ids TEXT NOT NULL DEFAULT '[]',
  report_ids TEXT NOT NULL DEFAULT '[]',
  agent_run_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  model_id TEXT,
  tools TEXT NOT NULL DEFAULT '[]',
  max_steps INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT,
  status TEXT NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL DEFAULT 10,
  input TEXT NOT NULL DEFAULT '',
  output TEXT,
  error TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  agent_id TEXT,
  name TEXT NOT NULL,
  default_level TEXT NOT NULL DEFAULT 'require-approval',
  rules TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  permission TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT,
  agent_run_id TEXT,
  target_path TEXT NOT NULL,
  expected_hash TEXT,
  old_text TEXT,
  new_text TEXT NOT NULL DEFAULT '',
  diff TEXT,
  reason TEXT,
  risk TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'proposed',
  validation TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT,
  agent_run_id TEXT,
  label TEXT NOT NULL,
  operation TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analysis_ids TEXT NOT NULL DEFAULT '[]',
  conversation_id TEXT,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  sections TEXT NOT NULL DEFAULT '[]',
  findings TEXT NOT NULL DEFAULT '[]',
  generated_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  target TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id);
`;
