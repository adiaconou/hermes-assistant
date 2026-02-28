/**
 * UI generation tool.
 */

import type { ToolDefinition } from '../../../tools/types.js';
import { validateInput } from '../../../tools/utils.js';
import { generatePage } from '../../../services/ui/index.js';

export const generateUi: ToolDefinition = {
  tool: {
    name: 'generate_ui',
    description: 'Host an HTML page and return its URL. You must provide complete HTML code including <style> and <script> tags.',
    input_schema: {
      type: 'object' as const,
      properties: {
        html: {
          type: 'string',
          description: 'Complete HTML code for the page body, including <style> and <script> tags. This is NOT a description - it must be actual HTML/CSS/JS code.',
        },
        title: {
          type: 'string',
          description: 'Title for the page (shown in browser tab)',
        },
      },
      required: ['html'],
    },
  },
  handler: async (input) => {
    const validationError = validateInput(input, {
      html: { type: 'string', required: true },
      title: { type: 'string', required: false },
    });
    if (validationError) return validationError;

    const { html, title } = input as { html: string; title?: string };
    const result = await generatePage({
      title: title ?? 'Generated Page',
      html,
    });
    return { success: true, ...result };
  },
};
