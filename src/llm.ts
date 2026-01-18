/**
 * LLM integration module.
 *
 * Wraps Anthropic SDK for generating responses with tool support.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Tool,
  ToolUseBlock,
  TextBlock,
  MessageParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import config from './config.js';
import type { Message } from './conversation.js';
import { generatePage, isSuccess, getSizeLimits } from './ui/index.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

const sizeLimits = getSizeLimits();

const SYSTEM_PROMPT = `You are a helpful SMS assistant. Keep responses concise since you communicate via SMS. Be direct and helpful.

## UI Generation Capability

You can generate interactive web pages for the user using the generate_ui tool. Use this when the user asks for:
- Lists they can check off (grocery lists, todo lists, packing lists)
- Interactive forms or calculators
- Any content that benefits from visual presentation or state persistence

When generating UI:
1. Create clean, mobile-friendly HTML
2. Use the provided helper functions for state persistence:
   - window.hermesLoadState() - loads saved state (returns object or null)
   - window.hermesSaveState(state) - saves state object
3. The page runs in a strict sandbox - NO network requests are allowed
4. Keep it simple and functional
5. Size limits: HTML ${sizeLimits.html} bytes, CSS ${sizeLimits.css} bytes, JS ${sizeLimits.js} bytes

Example: For a grocery list, create checkboxes that save their state when clicked.`;

/**
 * Tool definitions for the LLM.
 */
const TOOLS: Tool[] = [
  {
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
];

/**
 * Handle a tool call from the LLM.
 */
async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  console.log(JSON.stringify({
    level: 'info',
    message: 'Tool call received',
    toolName,
    inputKeys: Object.keys(toolInput),
    timestamp: new Date().toISOString(),
  }));

  if (toolName === 'generate_ui') {
    const { title, html, css, js } = toolInput as {
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
        return JSON.stringify({
          success: true,
          shortUrl: result.shortUrl,
          pageId: result.pageId,
        });
      } else {
        return JSON.stringify({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Page generation failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

/**
 * Generate a response using Claude with tool support.
 */
export async function generateResponse(
  userMessage: string,
  conversationHistory: Message[]
): Promise<string> {
  const anthropic = getClient();

  // Convert history to Anthropic format
  const messages: MessageParam[] = conversationHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  // Initial API call
  console.log(JSON.stringify({
    level: 'info',
    message: 'Calling Anthropic API',
    messageCount: messages.length,
    timestamp: new Date().toISOString(),
  }));

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages,
  });

  console.log(JSON.stringify({
    level: 'info',
    message: 'Anthropic API response',
    stopReason: response.stop_reason,
    contentTypes: response.content.map(b => b.type),
    timestamp: new Date().toISOString(),
  }));

  // Handle tool use loop
  let loopCount = 0;
  while (response.stop_reason === 'tool_use') {
    loopCount++;
    console.log(JSON.stringify({
      level: 'info',
      message: 'Processing tool use loop',
      loopCount,
      timestamp: new Date().toISOString(),
    }));

    const toolUseBlocks = response.content.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use'
    );

    // Process all tool calls
    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        const result = await handleToolCall(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: result,
        };
      })
    );

    // Add assistant response and tool results to messages
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    // Continue the conversation
    console.log(JSON.stringify({
      level: 'info',
      message: 'Continuing conversation after tool use',
      loopCount,
      timestamp: new Date().toISOString(),
    }));

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    console.log(JSON.stringify({
      level: 'info',
      message: 'Anthropic API response after tool',
      stopReason: response.stop_reason,
      contentTypes: response.content.map(b => b.type),
      timestamp: new Date().toISOString(),
    }));
  }

  // Extract final text response
  const textBlock = response.content.find(
    (block): block is TextBlock => block.type === 'text'
  );

  console.log(JSON.stringify({
    level: 'info',
    message: 'Returning final response',
    hasTextBlock: !!textBlock,
    responseLength: textBlock?.text?.length || 0,
    timestamp: new Date().toISOString(),
  }));

  return textBlock?.text || 'I could not generate a response.';
}
