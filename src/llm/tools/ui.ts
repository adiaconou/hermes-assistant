/**
 * UI generation tool.
 */

import type { ToolDefinition } from '../types.js';
import { generatePage, isSuccess } from '../../ui/index.js';

export const generateUi: ToolDefinition = {
  tool: {
    name: 'generate_ui',
    description: `Generate an interactive web page for the user. Use this for lists, forms, calculators, or any content that benefits from visual presentation. The page will be served at a short URL that the user can open in their browser.

IMPORTANT CONSTRAINTS:
- The page runs in a strict sandbox with NO network access
- No fetch(), XMLHttpRequest, WebSocket, or external resources allowed
- Use localStorage via window.hermesLoadState() and window.hermesSaveState() for persistence
- Keep HTML/CSS/JS concise and mobile-friendly
- Do NOT use external fonts, images, or scripts`,
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Page title (shown in browser tab)',
        },
        html: {
          type: 'string',
          description: 'HTML body content (not full document, just body contents)',
        },
        css: {
          type: 'string',
          description: 'Optional CSS styles (will be added to <style> tag)',
        },
        js: {
          type: 'string',
          description: 'Optional JavaScript (will be added to <script> tag). Use hermesLoadState/hermesSaveState for persistence.',
        },
      },
      required: ['title', 'html'],
    },
  },
  handler: async (input, _context) => {
    const { title, html, css, js } = input as {
      title: string;
      html: string;
      css?: string;
      js?: string;
    };

    console.log(JSON.stringify({
      level: 'info',
      message: 'Generating UI page',
      title,
      htmlLength: html?.length || 0,
      cssLength: css?.length || 0,
      jsLength: js?.length || 0,
      timestamp: new Date().toISOString(),
    }));

    try {
      const result = await generatePage({ title, html, css, js });

      console.log(JSON.stringify({
        level: 'info',
        message: 'Page generation result',
        success: isSuccess(result),
        result: isSuccess(result) ? { shortUrl: result.shortUrl } : { error: result.error },
        timestamp: new Date().toISOString(),
      }));

      if (isSuccess(result)) {
        return {
          success: true,
          shortUrl: result.shortUrl,
          pageId: result.pageId,
          generatedCode: {
            html,
            css: css || '',
            js: js || '',
          },
        };
      } else {
        return {
          success: false,
          error: result.error,
        };
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Page generation failed',
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
