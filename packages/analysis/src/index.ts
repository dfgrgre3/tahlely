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
