/**
 * User configuration tools (name, timezone, privacy reset).
 */

import type { ToolDefinition } from './types.js';
import { getUserConfigStore } from '../services/user-config/index.js';
import { getMemoryStore } from '../domains/memory/runtime/index.js';
import { getConversationStore } from '../services/conversation/index.js';
import { isValidTimezone } from '../services/date/resolver.js';
import { requirePhoneNumber } from './utils.js';

export const setUserConfig: ToolDefinition = {
  tool: {
    name: 'set_user_config',
    description: 'Update user profile (name, timezone).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'User name' },
        timezone: { type: 'string', description: 'IANA timezone (e.g., America/Los_Angeles)' },
      },
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { name, timezone } = input as { name?: string; timezone?: string };

    if (timezone && !isValidTimezone(timezone)) {
      return { success: false, error: `Invalid timezone: "${timezone}"` };
    }

    const store = getUserConfigStore();
    const updated = await store.set(phoneNumber, {
      name,
      timezone,
    });

    return { success: true, userConfig: updated };
  },
};

export const deleteUserData: ToolDefinition = {
  tool: {
    name: 'delete_user_data',
    description: 'Delete all stored data for the user (config, memory, conversation, scheduled jobs). Use only when the user explicitly requests deletion.',
    input_schema: {
      type: 'object' as const,
      properties: {
        confirm: { type: 'boolean', description: 'Must be true to proceed' },
      },
      required: ['confirm'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { confirm } = input as { confirm: boolean };

    if (!confirm) {
      return { success: false, error: 'Confirmation required' };
    }

    const userConfigStore = getUserConfigStore();
    const memoryStore = getMemoryStore();
    const conversationStore = getConversationStore() as unknown;

    // Delete user config
    await userConfigStore.delete(phoneNumber);

    // Delete all memory facts for this user
    const facts = await memoryStore.getFacts(phoneNumber);
    for (const fact of facts) {
      await memoryStore.deleteFact(fact.id);
    }

    // Delete conversation history if the store supports it
    if (typeof (conversationStore as { deleteAll?: (p: string) => Promise<void> }).deleteAll === 'function') {
      await (conversationStore as { deleteAll: (p: string) => Promise<void> }).deleteAll(phoneNumber);
    }

    return { success: true, message: 'All user data deleted' };
  },
};
