import type { Permission, PermissionDecision, Policy, PolicyEvaluation } from '@tahlely/domain';
import { DEFAULT_POLICY_LEVELS } from './permissions.js';

export interface PolicyInput {
  policies: Policy[];
  permission: Permission;
  projectId?: string | null;
  agentId?: string | null;
}

/**
 * Policy engine. Evaluation order (most specific wins):
 * agent+project policy → project policy → agent policy → global policy →
 * built-in defaults. Unknown permissions default to require-approval
 * (fail-closed).
 */
export function evaluatePolicy(input: PolicyInput): PolicyEvaluation {
  const { policies, permission, projectId, agentId } = input;
  const specificity = (policy: Policy): number => {
    let score = 0;
    if (policy.projectId && policy.projectId === projectId) score += 2;
    else if (policy.projectId) return -1;
    if (policy.agentId && policy.agentId === agentId) score += 1;
    else if (policy.agentId) return -1;
    return score;
  };

  let best: Policy | undefined;
  let bestScore = -1;
  for (const policy of policies) {
    const score = specificity(policy);
    if (score <= bestScore) continue;
    if (policy.rules[permission] === undefined) continue;
    best = policy;
    bestScore = score;
  }

  if (best) {
    const level = best.rules[permission];
    if (level) {
      return { decision: toDecision(level), matchedRule: 'explicit', level };
    }
  }
  const fallback = DEFAULT_POLICY_LEVELS[permission] ?? 'require-approval';
  return { decision: toDecision(fallback), matchedRule: 'default', level: fallback };
}

function toDecision(level: 'allow' | 'require-approval' | 'deny'): PermissionDecision {
  if (level === 'allow') return 'allow';
  if (level === 'deny') return 'deny';
  return 'require-approval';
}

/** Merge a partial rule set over a base policy (user overrides). */
export function withRuleOverrides(
  base: Policy,
  overrides: Partial<Record<Permission, 'allow' | 'require-approval' | 'deny'>>,
): Policy {
  return { ...base, rules: { ...base.rules, ...overrides } };
}
