import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQLITE_SCHEMA, dataDirLayout } from '@tahlely/persistence';
import { createRepositories } from '@tahlely/persistence/node';
import type { Project } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';

function project(): Project {
  const now = utcNow();
  return {
    id: newId('prj'),
    name: 'stored',
    rootPath: '/repo',
    kind: 'node',
    languages: ['typescript'],
    frameworks: ['react'],
    packageManagers: ['npm'],
    entryPoints: ['src/index.ts'],
    settings: { ignoredPaths: [], enableLocalIndex: true },
    createdAt: now,
    updatedAt: now,
  };
}

describe('persistence', () => {
  it('round-trips projects, conversations, and audit events', async () => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), 'tahlely-test-'));
    const repos = createRepositories(dir);
    const item = project();
    await repos.projects.saveProject(item);
    expect(await repos.projects.getProject(item.id)).toMatchObject({ name: 'stored' });

    const now = utcNow();
    await repos.conversations.saveConversation({
      id: newId('conv'),
      projectId: item.id,
      title: 'First',
      status: 'active',
      messageCount: 0,
      lastActiveAt: now,
      activeAgentIds: [],
      pinnedFilePaths: [],
      createdAt: now,
      updatedAt: now,
    });
    expect(await repos.conversations.listConversations(item.id)).toHaveLength(1);

    await repos.audit.append({
      id: newId('audit'),
      projectId: item.id,
      category: 'security',
      action: 'permission.approved',
      actor: 'user',
      metadata: {},
      at: now,
    });
    expect(await repos.audit.list(item.id)).toHaveLength(1);
    expect(dataDirLayout(dir).collections).toContain('audit');
  });

  it('exposes a SQLite schema covering every collection', () => {
    for (const table of ['projects', 'findings', 'conversations', 'audit_log', 'patches']) {
      expect(SQLITE_SCHEMA).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });
});
