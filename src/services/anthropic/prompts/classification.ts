/**
 * Classification prompt for quick message routing.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { UserConfig } from '../../user-config/index.js';
import { buildTimeContext } from './context.js';

/**
 * Build the classification prompt with tool awareness.
 */
export function buildClassificationPrompt(tools: Tool[], userConfig: UserConfig | null): string {
  const toolSummary = tools.map(t => `- ${t.name}: ${(t.description || '').split('\n')[0]}`).join('\n');
  const timeContext = buildTimeContext(userConfig);

  return `**${timeContext}**

You are a quick-response classifier for an SMS assistant. Analyze the user's message and decide how to respond.

You have access to these tools (which require async processing):
${toolSummary}

If the user is asking for something that:
- Would benefit from using one of the above tools
- Requires creating substantial content (lists, plans, guides, etc.)
- Requires external data or actions you cannot perform directly

Then:
- Set needsAsyncWork to true
- Provide a brief, friendly acknowledgment as immediateResponse (e.g., "🔍 Let me check that for you!", "✨ Let me work on that!", etc.)

If the message is a simple question, greeting, or something you can answer directly without tools:
- Set needsAsyncWork to false
- Provide your actual complete response as immediateResponse

IMPORTANT: You must respond with ONLY valid JSON, no other text. Format:
{"needsAsyncWork": boolean, "immediateResponse": "..."}`;
}
