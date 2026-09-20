import type { IgnoreRule } from '@tahlely/domain';

/** Built-in directory/file names that are never indexed as source. */
export const BUILTIN_IGNORES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'bin',
  'obj',
  'vendor',
  '.venv',
  '__pycache__',
  '.idea',
  '.vscode',
  'target',
  '.tauri',
] as const;

/** Binary/large extensions skipped for text analysis (still listed). */
export const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.svgz',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.mp3',
  '.mp4',
  '.wav',
  '.avi',
  '.mov',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.sqlite',
  '.db',
  '.bin',
  '.dat',
]);

export function builtinIgnoreRules(): IgnoreRule[] {
  return BUILTIN_IGNORES.map((pattern) => ({ pattern, source: 'builtin' }));
}

/**
 * Minimal gitignore-style matcher supporting `*`, `**`, trailing `/`
 * (directory-only), and `!` negation. It is intentionally small: full
 * gitignore semantics arrive with the native discovery layer (Phase 2).
 */
export class IgnoreMatcher {
  private readonly positive: RegExp[] = [];
  private readonly negative: RegExp[] = [];

  constructor(patterns: string[]) {
    for (const raw of patterns) {
      const pattern = raw.trim();
      if (!pattern || pattern.startsWith('#')) continue;
      if (pattern.startsWith('!')) {
        this.negative.push(globToRegExp(pattern.slice(1)));
      } else {
        this.positive.push(globToRegExp(pattern));
      }
    }
  }

  isIgnored(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    let ignored = this.positive.some((re) => re.test(normalized));
    if (ignored && this.negative.some((re) => re.test(normalized))) ignored = false;
    return ignored;
  }
}

function globToRegExp(glob: string): RegExp {
  let pattern = glob.trim();
  if (pattern.startsWith('/')) pattern = pattern.slice(1);
  const dirOnly = pattern.endsWith('/');
  if (dirOnly) pattern = pattern.slice(0, -1);
  const isLiteral = !/[*?[\]]/.test(pattern);
  const hasSlash = pattern.includes('/');
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      // Collapse consecutive * runs: *** also means "any depth".
      while (pattern[i] === '*') i += 1;
      if (pattern[i] === '/') i += 1;
      out += '(?:.*/)?';
      continue;
    }
    if (char === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if ('+()|^$.{}[]\\'.includes(char ?? '')) out += '\\';
    out += char;
    i += 1;
  }
  // Gitignore semantics: a pattern matching a directory excludes everything
  // under it. Bare literal names (node_modules, .git, dist) therefore match
  // at any depth INCLUDING descendants; anchored patterns match exactly.
  if (!hasSlash && (dirOnly || isLiteral)) return new RegExp(`(^|/)${out}(/.*)?$`);
  if (dirOnly) return new RegExp(`^${out}(/.*)?$`);
  if (!hasSlash) return new RegExp(`(^|/)${out}$`);
  return new RegExp(`^${out}$`);
}

export function isProbablyBinary(extension: string): boolean {
  return BINARY_EXTENSIONS.has(extension.toLowerCase());
}

/** Generated files are indexed but excluded from AI context and most rules. */
const GENERATED_MARKERS = [
  /\.min\.js$/,
  /\.bundle\.js$/,
  /\.d\.ts$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

export function isProbablyGenerated(relativePath: string): boolean {
  return GENERATED_MARKERS.some((re) => re.test(relativePath));
}
