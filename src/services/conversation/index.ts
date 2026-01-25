/**
 * @fileoverview Conversation store factory.
 *
 * Returns conversation store instance.
 * Singleton pattern - returns the same instance on repeated calls.
 */

import config from '../../config.js';
import type { ConversationStore, ConversationMessage, GetHistoryOptions } from './types.js';
import { SqliteConversationStore } from './sqlite.js';

export type { ConversationStore, ConversationMessage, GetHistoryOptions } from './types.js';

let instance: SqliteConversationStore | null = null;

/**
 * Get the conversation store instance.
 *
 * Returns a singleton instance that persists across calls.
 */
export function getConversationStore(): ConversationStore {
  if (instance) {
    return instance;
  }

  instance = new SqliteConversationStore(config.conversation.sqlitePath);
  return instance;
}

/**
 * Close the conversation store.
 * Call this during graceful shutdown.
 */
export function closeConversationStore(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/**
 * Reset the conversation store instance.
 * Useful for tests.
 */
export function resetConversationStore(): void {
  instance = null;
}
