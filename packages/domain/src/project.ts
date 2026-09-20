import type { ProjectScoped, Timestamps } from './common.js';
import type { FileId, ProjectId, WorkspaceId } from './ids.js';

export type LanguageId =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'csharp'
  | 'cpp'
  | 'ruby'
  | 'php'
  | 'html'
  | 'css'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'markdown'
  | 'sql'
  | 'shell'
  | 'plaintext'
  | 'unknown';

export type ProjectKind =
  'node' | 'python' | 'rust' | 'go' | 'java' | 'dotnet' | 'web-static' | 'monorepo' | 'unknown';

export interface Workspace extends Timestamps {
  id: WorkspaceId;
  name: string;
  projectIds: ProjectId[];
}

export interface ProjectSettings {
  ignoredPaths: string[];
  defaultProfileId?: string;
  defaultModelId?: string;
  enableLocalIndex: boolean;
}

export interface Project extends Timestamps {
  id: ProjectId;
  name: string;
  /** Absolute, normalized local path. Never a URL. */
  rootPath: string;
  kind: ProjectKind;
  languages: LanguageId[];
  frameworks: string[];
  packageManagers: string[];
  entryPoints: string[];
  settings: ProjectSettings;
}

/**
 * Internal file representation. Binary files are described, never decoded as
 * text. `hash`/`modifiedAt` drive incremental indexing and optimistic
 * concurrency for patches (expectedHash).
 */
export interface FileNode extends ProjectScoped {
  id: FileId;
  /** Absolute normalized path. */
  path: string;
  /** Path relative to the project root, posix-style. */
  relativePath: string;
  name: string;
  extension: string;
  language: LanguageId;
  size: number;
  hash?: string;
  modifiedAt?: string;
  ignored: boolean;
  generated: boolean;
  binary: boolean;
  analyzed: boolean;
  importance: number;
  risk: number;
}

export interface IgnoreRule {
  pattern: string;
  source: 'builtin' | 'gitignore' | 'app' | 'project' | 'profile';
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'internal' | 'external';
  specifier: string;
}

export interface DependencyGraph {
  projectId: ProjectId;
  nodes: string[];
  edges: DependencyEdge[];
  cycles: string[][];
  builtAt: string;
}
