/**
 * @tahlely/application — use cases, ports, event bus, background tasks.
 *
 * Depends only on @tahlely/domain. Infrastructure implements the ports;
 * the UI calls use cases. Business rules live here, never in views.
 */
export * from './ports.js';
export * from './event-bus.js';
export * from './task-manager.js';
export * from './use-cases.js';
