import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const alias = (name: string, target: string): [string, string] => [
  name,
  path.resolve(rootDir, target),
];
const aliases = Object.fromEntries([
  // Subpath aliases must precede their parents (Vite matches prefixes).
  alias('@tahlely/infrastructure/node', 'packages/infrastructure/src/node-fs.ts'),
  alias('@tahlely/execution/node', 'packages/execution/src/executor.ts'),
  alias('@tahlely/persistence/node', 'packages/persistence/src/factory.ts'),
  alias('@tahlely/persistence/memory', 'packages/persistence/src/memory-repositories.ts'),
  alias('@tahlely/domain', 'packages/domain/src/index.ts'),
  alias('@tahlely/application', 'packages/application/src/index.ts'),
  alias('@tahlely/infrastructure', 'packages/infrastructure/src/index.ts'),
  alias('@tahlely/analysis', 'packages/analysis/src/index.ts'),
  alias('@tahlely/ai', 'packages/ai/src/index.ts'),
  alias('@tahlely/agents', 'packages/agents/src/index.ts'),
  alias('@tahlely/security', 'packages/security/src/index.ts'),
  alias('@tahlely/execution', 'packages/execution/src/index.ts'),
  alias('@tahlely/reporting', 'packages/reporting/src/index.ts'),
  alias('@tahlely/persistence', 'packages/persistence/src/index.ts'),
]);

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: [
      'packages/*/tests/**/*.test.ts',
      'apps/desktop/src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 20000,
    reporters: ['default'],
  },
});
