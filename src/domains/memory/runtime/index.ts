/**
 * @fileoverview Memory domain runtime entry point.
 *
 * Re-exports the memory store factory and types from the service layer.
 */

export { getMemoryStore, resetMemoryStore, closeMemoryStore } from '../service/store.js';
export type { MemoryStore, UserFact } from '../service/store.js';
