import type { EventBus } from '@tahlely/application';
import type { AIProvider } from '@tahlely/ai';
import { buildContext } from '@tahlely/ai';
import type { Agent, AgentRun, Permission } from '@tahlely/domain';
import { AppError, newId, utcNow } from '@tahlely/domain';
import { evaluatePolicy } from '@tahlely/security';
import type { Policy } from '@tahlely/domain';

export interface AgentRunInput {
  agent: Agent;
  projectId: string;
  conversationId?: string;
  goal: string;
  model: string;
  /** Retrieval/pinned files the agent may see (explicit, budgeted). */
  contextFiles?: { path: string; content: string }[];
  policies?: Policy[];
  /** Called when a tool needs rights beyond policy (UI approval surface). */
  onPermissionRequired?: (input: {
    permission: Permission;
    action: string;
    target?: string;
  }) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface AgentPersistence {
  saveRun(run: AgentRun): Promise<void>;
}

export interface ToolExecutor {
  execute(tool: string, args: Record<string, unknown>): Promise<string>;
}

/**
 * Agent runtime (Prompt-1 scope): single-pass plan → gated tools → report.
 * The full multi-step autonomous loop lands in Phase 2 behind this same
 * orchestration boundary. Security properties held from day one:
 * - every tool call evaluates policy BEFORE execution;
 * - require-approval tools pause the run until onPermissionRequired resolves;
 * - denied tools abort the run with an audit-grade error;
 * - the model only ever sees budgeted, redacted context.
 */
export class AgentService {
  constructor(
    private readonly events: EventBus,
    private readonly provider: AIProvider,
    private readonly persistence?: AgentPersistence,
    private readonly tools?: ToolExecutor,
  ) {}

  async run(input: AgentRunInput): Promise<AgentRun> {
    const now = utcNow();
    const run: AgentRun = {
      id: newId('run'),
      agentId: input.agent.id,
      projectId: input.projectId as AgentRun['projectId'],
      conversationId: input.conversationId as AgentRun['conversationId'],
      status: 'running',
      currentStep: 0,
      maxSteps: input.agent.maxSteps,
      input: input.goal,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence?.saveRun(run);
    await this.events.emit(
      'AgentStarted',
      { agentRunId: run.id, projectId: run.projectId },
      run.projectId,
    );

    try {
      input.signal?.throwIfAborted();
      const assembled = buildContext(
        `You are ${input.agent.name}, a ${input.agent.role} agent. ${input.agent.instructions}`,
        input.goal,
        input.contextFiles ?? [],
        { maxChars: 24000, maxFiles: 12 },
      );
      const response = await this.provider.chat({
        model: input.model,
        messages: assembled.messages,
        signal: input.signal,
      });

      // Execute tool calls behind the permission gate, in order.
      for (const call of response.toolCalls) {
        input.signal?.throwIfAborted();
        const tool = input.agent.tools.find((t) => t.name === call.name);
        if (!tool) {
          throw new AppError(`Agent requested unknown tool: ${call.name}`, {
            kind: 'security-violation',
            code: 'AGENT_UNKNOWN_TOOL',
          });
        }
        const evaluation = evaluatePolicy({
          policies: input.policies ?? [],
          permission: tool.permission,
          projectId: input.projectId,
          agentId: input.agent.id,
        });
        if (evaluation.decision === 'deny') {
          throw new AppError(`Tool ${call.name} denied by policy.`, {
            kind: 'permission',
            code: 'AGENT_TOOL_DENIED',
          });
        }
        if (evaluation.decision === 'require-approval') {
          const approved = await this.requestApproval(input, tool.permission, call.name);
          if (!approved) {
            throw new AppError(`Tool ${call.name} was not approved.`, {
              kind: 'permission',
              code: 'AGENT_TOOL_REJECTED',
            });
          }
        }
        if (!this.tools) {
          throw new AppError(`No tool executor wired for ${call.name}.`, {
            kind: 'execution',
            code: 'AGENT_NO_TOOL_EXECUTOR',
          });
        }
        const args: Record<string, unknown> = JSON.parse(call.argumentsJson || '{}');
        await this.tools.execute(call.name, args);
        run.currentStep += 1;
        if (run.currentStep >= run.maxSteps) break;
      }

      const finished: AgentRun = {
        ...run,
        status: 'completed',
        output: response.content,
        endedAt: utcNow(),
        updatedAt: utcNow(),
      };
      await this.persistence?.saveRun(finished);
      await this.events.emit(
        'AgentCompleted',
        { agentRunId: run.id, projectId: run.projectId, status: 'completed' },
        run.projectId,
      );
      return finished;
    } catch (error) {
      const failed: AgentRun = {
        ...run,
        status: (error as { kind?: string }).kind === 'cancellation' ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
        endedAt: utcNow(),
        updatedAt: utcNow(),
      };
      await this.persistence?.saveRun(failed);
      await this.events.emit(
        'AgentCompleted',
        { agentRunId: run.id, projectId: run.projectId, status: failed.status },
        run.projectId,
      );
      throw error;
    }
  }

  private async requestApproval(
    input: AgentRunInput,
    permission: Permission,
    tool: string,
  ): Promise<boolean> {
    if (!input.onPermissionRequired) return false;
    return input.onPermissionRequired({
      permission,
      action: `Agent ${input.agent.name} requests ${tool}`,
    });
  }
}
