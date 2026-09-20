import type { FileSystemPort } from '@tahlely/application';
import type { LanguageId, ProjectKind } from '@tahlely/domain';
import { joinPosix } from '@tahlely/security';

export interface DiscoveryResult {
  kind: ProjectKind;
  languages: LanguageId[];
  frameworks: string[];
  packageManagers: string[];
  entryPoints: string[];
}

const LANGUAGE_BY_EXTENSION: Record<string, LanguageId> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
};

export function languageForExtension(extension: string): LanguageId {
  return LANGUAGE_BY_EXTENSION[extension.toLowerCase()] ?? 'unknown';
}

export function extensionOf(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Project discovery. Probes well-known manifest files (never full traversal)
 * to classify the project kind, frameworks, package managers, and entry
 * points. Cheap enough to run on every ProjectOpened event.
 */
export async function discoverProject(
  fs: FileSystemPort,
  rootPath: string,
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    kind: 'unknown',
    languages: [],
    frameworks: [],
    packageManagers: [],
    entryPoints: [],
  };
  const languages = new Set<LanguageId>();
  const root = rootPath.replace(/\\/g, '/');
  const has = async (name: string): Promise<boolean> => fs.exists(joinPosix(root, name));

  const [pkg, tsconfig, cargo, pyproject, goMod, pom, indexHtml] = await Promise.all([
    readJson(fs, rootPath, 'package.json'),
    has('tsconfig.json'),
    has('Cargo.toml'),
    has('pyproject.toml'),
    has('go.mod'),
    has('pom.xml'),
    has('index.html'),
  ]);
  const dotnet = await hasDotnetProject(fs, rootPath);

  if (pkg) {
    result.kind = 'node';
    languages.add(tsconfig ? 'typescript' : 'javascript');
    const deps = {
      ...((pkg.dependencies ?? {}) as Record<string, string>),
      ...((pkg.devDependencies ?? {}) as Record<string, string>),
    };
    for (const framework of [
      'react',
      'vue',
      'angular',
      'svelte',
      'next',
      'nuxt',
      'express',
      'fastify',
      'nest',
    ]) {
      if (deps[`@${framework}`] ?? deps[framework] ?? deps[`@angular/core`]) {
        if (framework === '@angular/core' || framework === 'angular') {
          if (!result.frameworks.includes('angular')) result.frameworks.push('angular');
        } else if (!result.frameworks.includes(framework)) {
          result.frameworks.push(framework);
        }
      }
    }
    if (deps['@tauri-apps/api']) result.frameworks.push('tauri');
    if (deps['electron']) result.frameworks.push('electron');
    const [npmLock, pnpmLock, yarnLock] = await Promise.all([
      has('package-lock.json'),
      has('pnpm-lock.yaml'),
      has('yarn.lock'),
    ]);
    if (npmLock) result.packageManagers.push('npm');
    if (pnpmLock) result.packageManagers.push('pnpm');
    if (yarnLock) result.packageManagers.push('yarn');
    if (typeof pkg.main === 'string') result.entryPoints.push(pkg.main);
    for (const candidate of [
      'src/main.ts',
      'src/main.tsx',
      'src/index.ts',
      'src/index.js',
      'src/App.tsx',
    ]) {
      if (await has(candidate)) result.entryPoints.push(candidate);
    }
  }
  if (cargo) {
    if (result.kind === 'unknown') result.kind = 'rust';
    languages.add('rust');
    result.packageManagers.push('cargo');
    if (await has('src/main.rs')) result.entryPoints.push('src/main.rs');
  }
  if (pyproject || (await has('requirements.txt')) || (await has('setup.py'))) {
    if (result.kind === 'unknown') result.kind = 'python';
    languages.add('python');
    if (pyproject) result.packageManagers.push('pip');
  }
  if (goMod) {
    if (result.kind === 'unknown') result.kind = 'go';
    languages.add('go');
  }
  if (pom) {
    if (result.kind === 'unknown') result.kind = 'java';
    languages.add('java');
    result.packageManagers.push('maven');
  }
  if (dotnet) {
    if (result.kind === 'unknown') result.kind = 'dotnet';
    languages.add('csharp');
  }
  if (indexHtml && result.kind === 'unknown') {
    result.kind = 'web-static';
    languages.add('html');
  }
  if (result.kind === 'node' && (await has('pnpm-workspace.yaml'))) {
    result.kind = 'monorepo';
  }
  result.languages = [...languages];
  return result;
}

async function hasDotnetProject(fs: FileSystemPort, root: string): Promise<boolean> {
  try {
    const entries = await fs.listDirectory(root.replace(/\\/g, '/'));
    return entries.some((entry) => /\.sln$|\.csproj$/i.test(entry));
  } catch {
    return false;
  }
}

async function readJson(
  fs: FileSystemPort,
  root: string,
  name: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readTextFile(joinPosix(root.replace(/\\/g, '/'), name));
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return undefined;
  } catch {
    return undefined;
  }
}
