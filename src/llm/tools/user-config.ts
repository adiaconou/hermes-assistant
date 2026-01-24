/**
 * User configuration tools.
 */

import type { ToolDefinition } from '../types.js';
import { requirePhoneNumber, isValidTimezone } from './utils.js';
import { getUserConfigStore, type UserConfig } from '../../services/user-config/index.js';

export const setUserConfig: ToolDefinition = {
  tool: {
    name: 'set_user_config',
    description: `Store user preferences. Call this when the user tells you:
- Their name ("I'm John", "Call me Sarah", "My name is Mike")
- Their timezone ("I'm in Pacific time", "EST", "I live in New York", "I'm in London")
- When they want to update these ("Call me Mike instead", "I moved to New York")`,
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: "User's preferred name or nickname",
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone identifier (e.g., "America/New_York", "America/Los_Angeles", "Europe/London"). Convert user input like "Pacific time" or "EST" to proper IANA format.',
        },
      },
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { name, timezone } = input as {
      name?: string;
      timezone?: string;
    };

    // Validate timezone if provided
    if (timezone && !isValidTimezone(timezone)) {
      return {
        success: false,
        error: `Invalid timezone: "${timezone}". Use IANA format like "America/New_York" or "America/Los_Angeles".`,
      };
    }

    try {
      const store = getUserConfigStore();
      const updates: Partial<UserConfig> = {};
      if (name !== undefined) updates.name = name;
      if (timezone !== undefined) updates.timezone = timezone;

      await store.set(phoneNumber, updates);

      console.log(JSON.stringify({
        level: 'info',
        message: 'User config updated',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        hasName: !!name,
        hasTimezone: !!timezone,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        updated: { name: !!name, timezone: !!timezone },
      };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to update user config',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const deleteUserData: ToolDefinition = {
  tool: {
    name: 'delete_user_data',
    description: 'Delete all stored user data when user requests it (e.g., "forget me", "delete my data"). This removes their name, timezone, and preferences.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  handler: async (_input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    try {
      const store = getUserConfigStore();
      await store.delete(phoneNumber);

      console.log(JSON.stringify({
        level: 'info',
        message: 'User data deleted',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        timestamp: new Date().toISOString(),
      }));

      return { success: true, message: 'All user data has been deleted.' };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to delete user data',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
