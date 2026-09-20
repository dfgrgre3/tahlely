/**
 * @tahlely/persistence — browser-safe barrel (schema + in-memory repos).
 * File-backed and future SQLite stores live behind `@tahlely/persistence/node`
 * so the desktop webview bundle never includes node-only modules.
 */
export * from './schema.js';
export * from './memory-repositories.js';
