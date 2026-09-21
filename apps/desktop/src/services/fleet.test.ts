import { describe, expect, it } from 'vitest';
import {
  BUILTIN_AGENTS,
  builtinAgentAnalyzerFocus,
  builtinAgentGoals,
  builtinAgents,
} from '@tahlely/agents';
import { launchAgentFleet, loadDemoProject, services } from './bootstrap.js';

describe('agent fleet definition', () => {
  it('ships 14 specialized agents, each with a goal and analyzer focus', () => {
    expect(BUILTIN_AGENTS.length).toBeGreaterThanOrEqual(14);
    for (const template of BUILTIN_AGENTS) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.goal.length).toBeGreaterThan(20);
      expect(template.analyzerFocus.length).toBeGreaterThan(0);
      expect(template.tools.length).toBeGreaterThan(0);
    }
    const names = BUILTIN_AGENTS.map((template) => template.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every analyzer in the engine with at least one agent', () => {
    const focus = builtinAgentAnalyzerFocus();
    const covered = new Set(Object.values(focus).flat());
    const analyzersInEngine = services.engine.analyzers.kinds();
    const uncovered = analyzersInEngine.filter((kind) => !covered.has(kind));
    expect(uncovered).toEqual([]);
  });

  it('gives every built-in agent a default goal', () => {
    const goals = builtinAgentGoals();
    for (const agent of builtinAgents()) {
      expect(goals[agent.name]).toBeTruthy();
    }
  });
});

describe('launchAgentFleet', () => {
  it('runs every agent concurrently on one project and reports per-agent results', async () => {
    const project = await loadDemoProject();
    const results = await launchAgentFleet(project.id);
    expect(results.length).toBeGreaterThanOrEqual(14);
    expect(results.every((result) => result.durationMs >= 0)).toBe(true);
    // Every agent either completed or failed with a reason — none vanished.
    for (const result of results) {
      if (result.status === 'failed') expect(result.error).toBeTruthy();
    }
    const runs = await services.agents.listRuns(project.id);
    expect(runs.length).toBeGreaterThanOrEqual(14);
  });
});
