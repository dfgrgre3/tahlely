/**
 * @tahlely/infrastructure — browser-safe adapters (no node: imports).
 * Node-only adapters (NodeFileSystem) live behind `@tahlely/infrastructure/node`
 * so the desktop webview bundle never includes server-only modules.
 */
export * from './logger.js';
export * from './config.js';
export * from './cache.js';
export * from './ignore-rules.js';
export * from './memory-fs.js';
export * from './tauri-fs.js';
export * from './project-discovery.js';
export * from './indexer.js';
