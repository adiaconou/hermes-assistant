/**
 * UI generation tool.
 */

import type { ToolDefinition } from './types.js';
import { generatePage } from '../ui/index.js';

export const generateUi: ToolDefinition = {
  tool: {
    name: 'generate_ui',
    description: 'Generate an interactive HTML/CSS/JS page. Returns a shortUrl for the hosted page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spec: {
          type: 'string',
          description: 'Detailed page requirements (HTML/CSS/JS should be fully specified in the response)',
        },
        title: {
          type: 'string',
          description: 'Title for the generated page (optional)',
        },
      },
      required: ['spec'],
    },
  },
  handler: async (input) => {
    const { spec, title } = input as { spec: string; title?: string };
    // The spec should contain the full page content (html, css, js)
    // For now, treat spec as the HTML content
    const result = await generatePage({
      title: title ?? 'Generated Page',
      html: spec,
    });
    return { success: true, ...result };
  },
};
