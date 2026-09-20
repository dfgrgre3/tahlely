/**
 * Default command allowlist. Execution NEVER runs through a shell, so only
 * the binary name + vetted subcommands matter. Project-local binaries
 * (node_modules/.bin, cargo, dotnet) are resolved by the caller and checked
 * against the same list. Operators extend this via ExecutionConfig.allowlistExtra.
 */
export interface AllowlistEntry {
  command: string;
  /** Allowed first arguments; empty = any args (still no shell metachars). */
  subcommands: string[];
  description: string;
}

export const DEFAULT_ALLOWLIST: AllowlistEntry[] = [
  { command: 'node', subcommands: [], description: 'Node.js runtime' },
  {
    command: 'npm',
    subcommands: ['test', 'run', 'ls', 'audit', 'outdated'],
    description: 'npm read/test tasks',
  },
  {
    command: 'npx',
    subcommands: ['tsc', 'eslint', 'vitest', 'prettier'],
    description: 'Pinned JS tooling',
  },
  { command: 'tsc', subcommands: [], description: 'TypeScript compiler' },
  { command: 'eslint', subcommands: [], description: 'ESLint' },
  { command: 'vitest', subcommands: ['run'], description: 'Vitest (non-watch)' },
  { command: 'pytest', subcommands: [], description: 'Python tests' },
  { command: 'ruff', subcommands: ['check'], description: 'Ruff linter (check only)' },
  {
    command: 'cargo',
    subcommands: ['test', 'check', 'clippy', 'fmt'],
    description: 'Rust check/test/clippy',
  },
  { command: 'go', subcommands: ['test', 'vet', 'build'], description: 'Go test/vet/build' },
  { command: 'dotnet', subcommands: ['test', 'build'], description: '.NET test/build' },
  {
    command: 'git',
    subcommands: ['status', 'diff', 'log', 'branch'],
    description: 'Git read-only',
  },
];

export function findAllowlistEntry(
  command: string,
  extra: AllowlistEntry[] = [],
): AllowlistEntry | undefined {
  const base = command.split('/').pop()?.split('\\').pop() ?? command;
  return [...extra, ...DEFAULT_ALLOWLIST].find((entry) => entry.command === base);
}

export function isSubcommandAllowed(entry: AllowlistEntry, args: string[]): boolean {
  if (entry.subcommands.length === 0) return true;
  const first = args[0];
  if (!first) return false;
  return entry.subcommands.includes(first);
}
