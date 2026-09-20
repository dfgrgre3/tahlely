import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@tahlely/application';
import { MockProvider } from '@tahlely/ai';
import { AgentService } from '@tahlely/agents';
import { createAgentTemplate } from '@tahlely/agents';
import type { AgentRun, ProjectId } from '@tahlely/domain';

describe('agent service', () => {
  it('completes a read-only run and persists it', async () => {
    const runs: AgentRun[] = [];
    const service = new AgentService(new EventBus(), new MockProvider(), {
      saveRun: async (run) => {
        runs.push(run);
      },
    });
    const agent = createAgentTemplate({
      name: 'Reviewer',
      role: 'reviewer',
      instructions: 'Review.',
    });
    const finished = await service.run({
      agent,
      projectId: 'prj_1' as unknown as string,
      goal: 'Summarize the project.',
      model: 'mock/mock-reviewer',
      contextFiles: [{ path: 'a.ts', content: 'const x = 1;' }],
    });
    expect(finished.status).toBe('completed');
    expect(finished.output).toContain('mock');
    expect(runs[runs.length - 1]?.status).toBe('completed');
    expect(finished.projectId).toBe('prj_1' as unknown as ProjectId);
  });

  it('denies tools rejected by policy without an executor', async () => {
    const toolProvider = new MockProvider();
    const chat = vi.spyOn(toolProvider, 'chat').mockResolvedValue({
      content: 'will edit',
      toolCalls: [{ id: 'c1', name: 'propose_patch', argumentsJson: '{}' }],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'mock',
      latencyMs: 1,
    });
    void chat;
    const service = new AgentService(new EventBus(), toolProvider);
    const agent = createAgentTemplate({ name: 'Doc', role: 'documenter', instructions: 'Docs.' });
    agent.tools = [
      { name: 'propose_patch', description: 'Propose a patch.', permission: 'WRITE_FILE' },
    ];
    await expect(
      service.run({
        agent,
        projectId: 'prj_1' as unknown as string,
        goal: 'Update docs.',
        model: 'mock/mock-reviewer',
        policies: [],
        // No onPermissionRequired → require-approval defaults to rejection.
      }),
    ).rejects.toThrow(/not approved/);
  });
});
