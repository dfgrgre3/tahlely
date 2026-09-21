/**
 * @tahlely/analysis — analyzer contracts, engine, profiles, built-ins.
 * Future analyzers (LSP-backed, tree-sitter, plugin) implement Analyzer.
 */
export * from './analyzer.js';
export * from './profiles.js';
export * from './engine.js';
export * from './builtin/common.js';
export * from './builtin/syntax-heuristics.js';
export * from './builtin/import-analyzer.js';
export * from './builtin/duplication-analyzer.js';
export * from './builtin/dead-code-analyzer.js';
export * from './builtin/security-heuristics.js';
export * from './builtin/strict-quality.js';
export * from './builtin/deep-correctness.js';
export * from './builtin/dependency-analyzer.js';
export * from './builtin/complexity-analyzer.js';
export * from './builtin/project-hygiene.js';
export * from './builtin/style-consistency.js';
export * from './builtin/error-handling.js';
export * from './builtin/compiler-analyzer.js';
export * from './builtin/architecture-analyzer.js';
export * from './builtin/config-analyzer.js';
export * from './builtin/api-contract-analyzer.js';
export * from './builtin/go-analyzer.js';
export * from './builtin/scripts-analyzer.js';
export * from './builtin/proto-analyzer.js';
export * from './builtin/universal-analyzer.js';
export * from './builtin/project-structure.js';
export * from './quality-score.js';
export * from './analytics.js';
export * from './suppressions.js';
export * from './run-diff.js';
