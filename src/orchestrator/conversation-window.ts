/**
 * Conversation Window
 *
 * Filters conversation history to a manageable sliding window that fits
 * within token budgets while preserving relevant context.
 *
 * This addresses the "Session Problem" - SMS/WhatsApp has no traditional
 * sessions, so we use a sliding window instead.
 */

import type { ConversationMessage } from '../services/conversation/types.js';
import type { ConversationWindowConfig } from './types.js';
import { DEFAULT_CONVERSATION_WINDOW } from './types.js';

/**
 * Estimate token count for a message.
 * Uses ~3.3 chars-per-token which is closer to Claude's actual tokenization
 * than the commonly-cited 4 chars/token (which underestimates by ~30%).
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 3.3);
}

/**
 * Filter conversation history to a sliding window.
 *
 * Applies three constraints in order:
 * 1. Age filter: exclude messages older than maxAgeHours
 * 2. Count limit: keep most recent maxMessages
 * 3. Token limit: drop oldest messages to fit within maxTokens
 *
 * Returns messages in chronological order (oldest first).
 *
 * @param messages Full conversation history
 * @param config Window configuration (uses defaults if not provided)
 * @returns Filtered messages within the window constraints
 */
export function getRelevantHistory(
  messages: ConversationMessage[],
  config: ConversationWindowConfig = DEFAULT_CONVERSATION_WINDOW
): ConversationMessage[] {
  if (messages.length === 0) {
    return [];
  }

  const now = Date.now();
  const cutoffTime = now - config.maxAgeHours * 60 * 60 * 1000;

  // 1. Filter by age
  let filtered = messages.filter(m => m.createdAt >= cutoffTime);

  // 2. Sort newest first, take most recent N
  filtered = filtered
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, config.maxMessages);

  // 3. Reverse to chronological order (oldest first)
  filtered = filtered.reverse();

  // 4. Trim to token budget (drop oldest messages if over budget)
  let totalTokens = 0;
  const result: ConversationMessage[] = [];

  // Start from the end (newest) and work backwards
  // This ensures we keep the most recent messages when trimming
  for (let i = filtered.length - 1; i >= 0; i--) {
    const msg = filtered[i];
    const msgTokens = estimateTokens(msg.content);

    if (totalTokens + msgTokens <= config.maxTokens) {
      result.unshift(msg); // Add to front to maintain chronological order
      totalTokens += msgTokens;
    } else {
      // Stop adding messages once we hit the token limit
      break;
    }
  }

  return result;
}

/**
 * Format conversation history for inclusion in prompts.
 * Returns a string representation of the messages.
 */
export function formatHistoryForPrompt(messages: ConversationMessage[]): string {
  if (messages.length === 0) {
    return '(No recent conversation history)';
  }

  return messages
    .map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      return `${role}: ${m.content}`;
    })
    .join('\n');
}

/**
 * Get statistics about a conversation window.
 * Useful for debugging and observability.
 */
export function getWindowStats(messages: ConversationMessage[]): {
  messageCount: number;
  totalTokens: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
} {
  if (messages.length === 0) {
    return {
      messageCount: 0,
      totalTokens: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
    };
  }

  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  );

  return {
    messageCount: messages.length,
    totalTokens,
    oldestTimestamp: messages[0].createdAt,
    newestTimestamp: messages[messages.length - 1].createdAt,
  };
}
