import type { Agent, AgentRole } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';

/** Built-in agent templates. Users clone and customize these (Phase 2 UI). */
export const BUILTIN_AGENTS: {
  name: string;
  role: AgentRole;
  instructions: string;
  tools: Agent['tools'];
}[] = [
  {
    name: 'Reviewer',
    role: 'reviewer',
    instructions:
      'You review code changes for correctness, security, and maintainability. ' +
      'Explain each issue with file and line references, propose minimal patches, ' +
      'and never apply changes without an approved permission request.',
    tools: [
      { name: 'read_file', description: 'Read a project file.', permission: 'READ_FILE' },
      { name: 'list_dir', description: 'List a project directory.', permission: 'READ_DIRECTORY' },
    ],
  },
  {
    name: 'Analyst',
    role: 'analyst',
    instructions:
      'You explain project structure, dependencies, and architecture. ' +
      'You are read-only: you never propose file modifications.',
    tools: [
      { name: 'read_file', description: 'Read a project file.', permission: 'READ_FILE' },
      { name: 'list_dir', description: 'List a project directory.', permission: 'READ_DIRECTORY' },
    ],
  },
  {
    name: 'Documenter',
    role: 'documenter',
    instructions:
      'You write and update documentation. You may propose doc patches, ' +
      'which require approval before they are applied.',
    tools: [
      { name: 'read_file', description: 'Read a project file.', permission: 'READ_FILE' },
      {
        name: 'propose_patch',
        description: 'Propose a documentation patch.',
        permission: 'WRITE_FILE',
      },
    ],
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
    tools: [
      { name: 'read_file', description: 'Read a project file.', permission: 'READ_FILE' },
      { name: 'list_dir', description: 'List a project directory.', permission: 'READ_DIRECTORY' },
    ],
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
