import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '@tahlely/security';
import type { Policy } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';

function policy(overrides: Partial<Policy>): Policy {
  const now = utcNow();
  return {
    id: newId('pol'),
    projectId: null,
    agentId: null,
    name: 'test',
    defaultLevel: 'require-approval',
    rules: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('policy engine', () => {
  it('falls back to built-in defaults (reads allow, writes need approval)', () => {
    expect(evaluatePolicy({ policies: [], permission: 'READ_FILE' }).decision).toBe('allow');
    expect(evaluatePolicy({ policies: [], permission: 'WRITE_FILE' }).decision).toBe(
      'require-approval',
    );
    expect(evaluatePolicy({ policies: [], permission: 'SYSTEM_ACCESS' }).decision).toBe('deny');
  });

  it('prefers the most specific matching policy', () => {
    const global = policy({ rules: { WRITE_FILE: 'deny' } });
    const project = policy({
      projectId: 'prj_1' as Policy['projectId'],
      rules: { WRITE_FILE: 'allow' },
    });
    const result = evaluatePolicy({
      policies: [global, project],
      permission: 'WRITE_FILE',
      projectId: 'prj_1',
    });
    expect(result.decision).toBe('allow');
    expect(result.matchedRule).toBe('explicit');
  });

  it('ignores policies scoped to other projects', () => {
    const other = policy({
      projectId: 'prj_9' as Policy['projectId'],
      rules: { WRITE_FILE: 'allow' },
    });
    const result = evaluatePolicy({
      policies: [other],
      permission: 'WRITE_FILE',
      projectId: 'prj_1',
    });
    expect(result.matchedRule).toBe('default');
  });
});
