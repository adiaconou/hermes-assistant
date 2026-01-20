/**
 * @fileoverview User config store factory.
 *
 * Returns user config store instance.
 * Singleton pattern - returns the same instance on repeated calls.
 */

import config from '../../config.js';
import type { UserConfigStore, UserConfig } from './types.js';
import { SqliteUserConfigStore } from './sqlite.js';

export type { UserConfigStore, UserConfig } from './types.js';

let instance: UserConfigStore | null = null;

/**
 * Get the user config store instance.
 *
 * Uses the same database path as credentials store.
 */
export function getUserConfigStore(): UserConfigStore {
  if (instance) {
    return instance;
  }

  // Use same path as credentials - they share the database file
  instance = new SqliteUserConfigStore(config.credentials.sqlitePath);
  return instance;
}

/**
 * Reset the user config store instance.
 * Useful for tests.
 */
export function resetUserConfigStore(): void {
  instance = null;
}
