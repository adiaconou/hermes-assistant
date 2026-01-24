/**
 * @fileoverview Memory store factory.
 *
 * Returns memory store instance.
 * Singleton pattern - returns the same instance on repeated calls.
 */

import config from '../../config.js';
import type { MemoryStore, UserFact } from './types.js';
import { SqliteMemoryStore } from './sqlite.js';

export type { MemoryStore, UserFact } from './types.js';

let instance: MemoryStore | null = null;

/**
 * Get the memory store instance.
 *
 * Returns a singleton instance that persists across calls.
 */
export function getMemoryStore(): MemoryStore {
  if (instance) {
    return instance;
  }

  instance = new SqliteMemoryStore(config.memory.sqlitePath);
  return instance;
}

/**
 * Reset the memory store instance.
 * Useful for tests.
 */
export function resetMemoryStore(): void {
  instance = null;
}
