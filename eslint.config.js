import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/target/**',
      '**/coverage/**',
      'apps/desktop/src-tauri/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['scripts/**/*.mjs', 'vitest.config.ts', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/tests/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Packages must stay UI-free: no DOM globals by default (libraries run in
      // Node workers, the Rust sidecar, and the renderer through adapters).
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage'],
    },
  },
);
