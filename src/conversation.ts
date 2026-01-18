/**
 * In-memory conversation store.
 *
 * Stores conversation history per phone number. Memory clears on server restart.
 */

export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

const MAX_MESSAGES = 50;

const conversations = new Map<string, Message[]>();

/**
 * Get conversation history for a phone number.
 */
export function getHistory(phoneNumber: string): Message[] {
  return conversations.get(phoneNumber) || [];
}

/**
 * Add a message to conversation history.
 */
export function addMessage(
  phoneNumber: string,
  role: 'user' | 'assistant',
  content: string
): void {
  let history = conversations.get(phoneNumber);

  if (!history) {
    history = [];
    conversations.set(phoneNumber, history);
  }

  history.push({ role, content });

  // Keep only last MAX_MESSAGES
  if (history.length > MAX_MESSAGES) {
    conversations.set(phoneNumber, history.slice(-MAX_MESSAGES));
  }
}
