import { openProject } from '@tahlely/application';
import { MemoryFileSystem, discoverProject, indexProject } from '@tahlely/infrastructure';
import type { Project } from '@tahlely/domain';
import { utcNow } from '@tahlely/domain';
import { registerProjectFileSystem, services } from './bootstrap.js';

export interface UploadedFile {
  relativePath: string;
  content: string;
}

const SKIP_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'exe',
  'dll',
  'so',
  'zip',
  'gz',
  'tar',
  'pdf',
  'mp4',
  'mp3',
]);

/** Browser-safe upload filter: skip binaries and oversized files. */
export function shouldSkipUpload(fileName: string, size: number): boolean {
  if (size > 1024 * 1024) return true;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return SKIP_EXTENSIONS.has(ext);
}

export function normalizeUploadedFile(file: File & { webkitRelativePath?: string }): {
  rootName: string;
  relativePath: string;
} {
  const raw = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
  const parts = raw.split('/').filter(Boolean);
  const rootName = parts.length > 1 ? (parts[0] ?? 'project') : 'project';
  const relativePath = parts.length > 1 ? parts.slice(1).join('/') : file.name;

  return { rootName, relativePath };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}

/**
 * Import a whole project folder uploaded from the browser (webkitdirectory)
 * into an in-memory filesystem, then register, discover, and index it so the
 * Workspace / File Review / analysis pipeline work exactly like a disk folder.
 * There is no file-count limit beyond what the caller collected; each file is
 * already capped by shouldSkipUpload.
 */
export async function importUploadedFolder(name: string, files: UploadedFile[]): Promise<Project> {
  if (files.length === 0) {
    throw new Error('The uploaded folder contained no readable text files.');
  }
  const rootPath = `/uploads/${slugify(name)}-${Date.now().toString(36)}`;
  const seed: Record<string, string> = {};
  for (const file of files) {
    const rel = file.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (rel) seed[`${rootPath}/${rel}`] = file.content;
  }
  const fs = new MemoryFileSystem(seed);
  const project = await openProject(
    {
      projects: services.projects,
      conversations: services.conversations,
      analyses: services.analyses,
      policies: services.policies,
      changes: services.changes,
      audit: services.audit,
      fs,
      events: services.bus,
    },
    { name, rootPath },
  );
  registerProjectFileSystem(project.id, fs);
  const discovery = await discoverProject(fs, project.rootPath);
  const enriched: Project = {
    ...project,
    kind: discovery.kind,
    languages: discovery.languages,
    frameworks: discovery.frameworks,
    packageManagers: discovery.packageManagers,
    entryPoints: discovery.entryPoints,
    updatedAt: utcNow(),
  };
  await services.projects.saveProject(enriched);
  const outcome = await indexProject(fs, project.id, project.rootPath, {
    maxFiles: 20000,
    maxFileSizeBytes: 1024 * 1024,
    extraIgnores: [],
    respectGitignore: true,
  });
  await services.fileIndex.clearProject(project.id);
  await services.fileIndex.upsertFiles(outcome.files);
  return enriched;
}
