import type { Agent, AgentRole } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';

const READ_TOOLS: Agent['tools'] = [
  { name: 'read_file', description: 'Read a project file.', permission: 'READ_FILE' },
  { name: 'list_dir', description: 'List a project directory.', permission: 'READ_DIRECTORY' },
];

const ALL_TOOLS: Agent['tools'] = [
  ...READ_TOOLS,
  {
    name: 'write_file',
    description: 'Write improved content to a file (approval required).',
    permission: 'WRITE_FILE',
  },
  {
    name: 'delete_file',
    description: 'Delete a redundant file (approval required).',
    permission: 'DELETE_FILE',
  },
];

export interface BuiltinAgentTemplate {
  name: string;
  role: AgentRole;
  instructions: string;
  tools: Agent['tools'];
  analyzerFocus: string[];
  goal: string;
}

export const BUILTIN_AGENTS: BuiltinAgentTemplate[] = [
  {
    name: 'Code Reviewer',
    role: 'reviewer',
    instructions:
      'Review code for correctness bugs, logic errors, and edge cases. Report each with file:line and a concrete fix.',
    tools: READ_TOOLS,
    analyzerFocus: ['deep-correctness', 'strict-quality', 'syntax'],
    goal: 'Review the codebase for correctness bugs, logic errors, and edge cases. Report each issue with file:line and a concrete fix.',
  },
  {
    name: 'Architecture Analyst',
    role: 'analyst',
    instructions:
      'Analyze project structure, module boundaries, dependency flow, and architectural patterns. Identify tight coupling, circular dependencies, and layering violations.',
    tools: READ_TOOLS,
    analyzerFocus: ['architecture', 'imports', 'duplication'],
    goal: 'Analyze the project architecture: module boundaries, dependency flow, coupling, and structural patterns. Report violations and improvements.',
  },
  {
    name: 'Security Auditor',
    role: 'reviewer',
    instructions:
      'Focus exclusively on security: hardcoded secrets, injection risks, XSS, insecure crypto, exposed credentials, and unsafe patterns. Report each with severity, file:line, and remediation.',
    tools: READ_TOOLS,
    analyzerFocus: ['security-heuristics', 'hygiene'],
    goal: 'Audit the project for security vulnerabilities: hardcoded secrets, injection, XSS, insecure crypto, and exposed configuration.',
  },
  {
    name: 'Dependency Auditor',
    role: 'analyst',
    instructions:
      'Audit dependency health: undeclared imports, unused packages, dev-only packages used at runtime, version pinning, and supply-chain risks.',
    tools: READ_TOOLS,
    analyzerFocus: ['dependencies', 'imports'],
    goal: 'Audit dependency health: undeclared imports, unused packages, dev-only runtime usage, and supply-chain risks.',
  },
  {
    name: 'Type Safety Analyst',
    role: 'analyst',
    instructions:
      'Analyze TypeScript type correctness: implicit any, type mismatches, nullable access without guards, and missing type annotations.',
    tools: READ_TOOLS,
    analyzerFocus: ['compiler', 'deep-correctness'],
    goal: 'Analyze TypeScript type safety: implicit any, type mismatches, nullable access, and missing annotations. Report each with the exact fix.',
  },
  {
    name: 'Performance Analyst',
    role: 'analyst',
    instructions:
      'Analyze performance: nested loops, O(n²) patterns, unnecessary allocations, N+1 queries, and complexity hotspots.',
    tools: READ_TOOLS,
    analyzerFocus: ['complexity', 'deep-correctness'],
    goal: 'Analyze performance: nested loops, O(n²) patterns, complexity hotspots, and allocation inefficiencies. Report each with optimizations.',
  },
  {
    name: 'Style Auditor',
    role: 'reviewer',
    instructions:
      'Audit code style consistency: naming conventions, indentation, quote style, trailing whitespace, and formatting.',
    tools: READ_TOOLS,
    analyzerFocus: ['style-consistency', 'strict-quality'],
    goal: 'Audit code style consistency: naming, indentation, quotes, whitespace, and formatting. Report each violation with the fix.',
  },
  {
    name: 'Error Handling Auditor',
    role: 'reviewer',
    instructions:
      'Audit error handling: unhandled promises, empty catch blocks, async without try, throw in timers, and swallowed exceptions.',
    tools: READ_TOOLS,
    analyzerFocus: ['error-handling', 'deep-correctness'],
    goal: 'Audit error handling: unhandled promises, empty catches, async without try, and swallowed exceptions. Report each with the correct pattern.',
  },
  {
    name: 'Dead Code Hunter',
    role: 'analyst',
    instructions:
      'Hunt for dead code: unused exports, unreferenced functions, unreachable code, and commented-out blocks.',
    tools: READ_TOOLS,
    analyzerFocus: ['dead-code', 'deep-correctness'],
    goal: 'Hunt for dead code: unused exports, unreferenced functions, unreachable code, and commented-out blocks. Report each with a removal recommendation.',
  },
  {
    name: 'Integration Auditor',
    role: 'analyst',
    instructions:
      'Audit imports and integrations: broken relative imports, missing modules, circular dependencies, and unresolved externals.',
    tools: READ_TOOLS,
    analyzerFocus: ['imports', 'dependencies', 'universal', 'deep-correctness'],
    goal: 'Audit imports and integrations: broken relative imports, missing modules, circular dependencies, unresolved externals, and every non-TS ecosystem file (SQL, HTML, Docker, Go, Rust, Java). Report each with a fix.',
  },
  {
    name: 'Hygiene Auditor',
    role: 'analyst',
    instructions:
      'Audit project hygiene: missing .gitignore, committed secrets, missing lockfile, no test script, Dockerfile anti-patterns, and CI misconfigurations.',
    tools: READ_TOOLS,
    analyzerFocus: ['hygiene', 'project-structure', 'security-heuristics'],
    goal: 'Audit project hygiene and structure: missing .gitignore/README/LICENSE, committed secrets, missing lockfile, no test script, no CI, deep nesting, mixed naming, Dockerfile and CI issues. Report each with a fix.',
  },
  {
    name: 'Complexity Analyst',
    role: 'analyst',
    instructions:
      'Analyze code complexity: high cyclomatic complexity, over-long functions, deep nesting, and over-long files.',
    tools: READ_TOOLS,
    analyzerFocus: ['complexity', 'strict-quality'],
    goal: 'Analyze code complexity: high cyclomatic complexity, over-long functions, deep nesting, and over-long files. Report each with a refactoring recommendation.',
  },
  {
    name: 'Documentation Analyst',
    role: 'documenter',
    instructions:
      'Analyze documentation coverage: missing JSDoc on public APIs, missing README sections, undocumented exports, and orphaned docs.',
    tools: READ_TOOLS,
    analyzerFocus: ['strict-quality'],
    goal: 'Analyze documentation coverage: missing JSDoc on public APIs, missing README sections, undocumented exports. Report gaps with suggestions.',
  },
  {
    name: 'Fixer',
    role: 'refactorer',
    instructions:
      'Fix issues found by analysis: apply minimal, safe edits. Every write or delete requires an approved permission request.',
    tools: ALL_TOOLS,
    analyzerFocus: ['deep-correctness', 'strict-quality', 'security-heuristics'],
    goal: 'Fix the highest-priority issues found by analysis. Apply minimal, safe edits. Every write requires approval.',
  },
];

export function createAgentTemplate(input: {
  name: string;
  role: AgentRole;
  instructions: string;
  projectId?: Agent['projectId'];
}): Agent {
  const now = utcNow();
  return {
    id: newId('agent'),
    projectId: input.projectId ?? null,
    name: input.name,
    role: input.role,
    instructions: input.instructions,
    tools: [...READ_TOOLS],
    maxSteps: 10,
    createdAt: now,
    updatedAt: now,
  };
}

export function builtinAgents(): Agent[] {
  const now = utcNow();
  return BUILTIN_AGENTS.map((template) => ({
    id: newId('agent'),
    projectId: null,
    name: template.name,
    role: template.role,
    instructions: template.instructions,
    tools: template.tools,
    maxSteps: 10,
    createdAt: now,
    updatedAt: now,
  }));
}

export function builtinAgentGoals(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const template of BUILTIN_AGENTS) out[template.name] = template.goal;
  return out;
}

export function builtinAgentAnalyzerFocus(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const template of BUILTIN_AGENTS) out[template.name] = template.analyzerFocus;
  return out;
}
