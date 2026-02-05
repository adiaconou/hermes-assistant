/**
 * Conversation history management.
 *
 * Provides interface for conversation history storage.
 * Uses SQLite for persistence (survives server restarts).
 */

import { getConversationStore } from './services/conversation/index.js';
import type { StoredMediaAttachment, ConversationMessage } from './services/conversation/types.js';

export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

const MAX_MESSAGES = 50;

/**
 * Get conversation history for a phone number.
 * Returns messages in chronological order (oldest first).
 */
export async function getHistory(phoneNumber: string): Promise<Message[]> {
  const store = getConversationStore();
  const messages = await store.getHistory(phoneNumber, { limit: MAX_MESSAGES });

  // Convert to simple Message format for backward compatibility
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * Add a message to conversation history.
 * @returns The created message with generated ID
 */
export async function addMessage(
  phoneNumber: string,
  role: 'user' | 'assistant',
  content: string,
  channel: 'sms' | 'whatsapp' = 'sms',
  mediaAttachments?: StoredMediaAttachment[]
): Promise<ConversationMessage> {
  const store = getConversationStore();
  return store.addMessage(phoneNumber, role, content, channel, mediaAttachments);
}
