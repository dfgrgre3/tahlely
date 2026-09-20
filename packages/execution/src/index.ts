/**
 * @tahlely/execution — browser-safe barrel (allowlist + request/result types).
 * The Node process runner is intentionally excluded: UI code must never
 * import it. Node/CLI hosts use `@tahlely/execution/node`.
 */
export * from './allowlist.js';
export * from './types.js';
