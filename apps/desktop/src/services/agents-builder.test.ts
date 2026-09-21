import { describe, expect, it } from 'vitest';
import { providerForModel, saveCustomAgent, services } from './bootstrap.js';

describe('saveCustomAgent', () => {
  it('persists a custom agent with gated write tools and read_file by default', async () => {
    const agent = await saveCustomAgent({
      name: 'Security sweeper',
      role: 'custom',
      instructions: 'Find secrets and propose fixes.',
      toolNames: ['write_file', 'delete_file'],
    });
    expect(agent.tools.map((t) => t.name)).toEqual(['read_file', 'write_file', 'delete_file']);
    expect(agent.tools.find((t) => t.name === 'delete_file')?.permission).toBe('DELETE_FILE');
    const listed = await services.agents.listAgents();
    expect(listed.some((a) => a.id === agent.id)).toBe(true);
  });

  it('applies safe defaults for empty fields', async () => {
    const agent = await saveCustomAgent({
      name: '  ',
      role: 'reviewer',
      instructions: '',
      toolNames: [],
    });
    expect(agent.name).toBe('Custom agent');
    expect(agent.tools.map((t) => t.name)).toEqual(['read_file']);
  });
});

describe('providerForModel', () => {
  it('falls back to the offline mock for unknown refs', () => {
    expect(providerForModel(undefined).id).toBe('mock');
    expect(providerForModel('mock/mock-reviewer').id).toBe('mock');
    expect(providerForModel('missing/model').id).toBe('mock');
  });
});
