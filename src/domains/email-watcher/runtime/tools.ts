/**
 * Email watcher tools.
 *
 * Provides the toggle tool for enabling/disabling the email watcher.
 * Email skill CRUD has been removed — skills are now managed via filesystem skill packs.
 */

import type { ToolDefinition } from '../../../tools/types.js';
import { requirePhoneNumber } from '../../../tools/utils.js';
import { getUserConfigStore } from '../../../services/user-config/index.js';

export const toggleEmailWatcher: ToolDefinition = {
  tool: {
    name: 'toggle_email_watcher',
    description: 'Enable or disable the email watcher for the current user. When disabled, no emails are processed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true to enable email watching, false to disable',
        },
      },
      required: ['enabled'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { enabled } = input as { enabled: boolean };

    const userConfigStore = getUserConfigStore();
    await userConfigStore.set(phoneNumber, { emailWatcherEnabled: enabled });

    return {
      success: true,
      email_watcher_enabled: enabled,
      message: enabled
        ? 'Email watching is now enabled. I will process your incoming emails.'
        : 'Email watching is now paused. No emails will be processed until re-enabled.',
    };
  },
};
