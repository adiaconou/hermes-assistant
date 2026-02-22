/**
 * Classification prompt for quick message routing.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { UserConfig } from '../../user-config/index.js';
import type { UserFact } from '../../../domains/memory/types.js';
import { buildTimeContext, buildUserMemoryXml } from './context.js';

/**
 * Build the classification prompt with tool awareness.
 */
export function buildClassificationPrompt(
  tools: Tool[],
  userConfig: UserConfig | null,
  userFacts: UserFact[] = []
): string {
  const toolSummary = tools.map(t => `- ${t.name}: ${(t.description || '').split('\n')[0]}`).join('\n');
  const timeContext = buildTimeContext(userConfig);
  const memoryXml = buildUserMemoryXml(userFacts, { maxFacts: 10, maxChars: 600 });
  const memorySection = memoryXml ? `\n${memoryXml}\n` : '';

  return `**${timeContext}**
${memorySection}

You are a quick-response classifier for an SMS assistant. Analyze the user's message and decide how to respond.

Use any relevant facts from <user_memory> to personalize or avoid incorrect immediate responses.

You have access to these tools (which require async processing):
${toolSummary}

Classify with these rules:
- Messages with media attachments (images, files, etc. — indicated by "[User sent ...]" hints) MUST set needsAsyncWork to true. Media always requires async processing for analysis. Respond with a short acknowledgment.
- Memory-directed messages (remember, recall, forget/delete/update a fact, "what do you know/remember about me") MUST set needsAsyncWork to true so the memory tools run. Respond with a short acknowledgment as immediateResponse.
- Tasks that need tools or substantial work (lists, plans, external data/actions) → needsAsyncWork=true with a brief acknowledgment.
- Simple questions/greetings you can answer directly without tools → needsAsyncWork=false and immediateResponse is the full answer.

IMPORTANT: You must respond with ONLY valid JSON, no other text. Format:
{"needsAsyncWork": boolean, "immediateResponse": "..."}`;
}
