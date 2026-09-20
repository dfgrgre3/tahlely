/**
 * @tahlely/domain — framework-free domain contracts.
 *
 * Dependency rule: this package imports NOTHING outside itself.
 * Every entity is a plain JSON-serializable interface so it can cross
 * IPC (Tauri invoke), workers, and the SQLite persistence layer unchanged.
 */
export * from './ids.js';
export * from './hash.js';
export * from './attachment-id.js';
export * from './common.js';
export * from './errors.js';
export * from './project.js';
export * from './analysis.js';
export * from './finding.js';
export * from './report.js';
export * from './conversation.js';
export * from './agent.js';
export * from './ai.js';
export * from './permission.js';
export * from './patch.js';
export * from './events.js';
export * from './tasks.js';
export * from './audit.js';
