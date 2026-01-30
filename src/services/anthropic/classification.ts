/**
 * Message classification for quick routing.
 *
 * The legacy generateResponse path has been removed in favor of the
 * orchestrator + shared tool executor. This file now only exposes
 * classifyMessage used by the SMS router.
 */

import type { TextBlock, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { Message } from '../../conversation.js';
import type { UserConfig } from '../user-config/index.js';

import { getClient } from './client.js';
import { buildClassificationPrompt } from './prompts/index.js';
import { TOOLS } from '../../tools/index.js';

export type { ClassificationResult } from './types.js';

/**
 * Quickly classify a message to determine if async processing is needed.
 *
 * This is a "fast path" call that:
 * - Uses fewer tokens (max_tokens: 512)
 * - Has NO tools enabled (faster response)
 * - Only looks at recent history (last 4 messages)
 */
export async function classifyMessage(
  userMessage: string,
  conversationHistory: Message[],
  userConfig?: UserConfig | null
) : Promise<{ needsAsyncWork: boolean; immediateResponse: string }> {
  const anthropic = getClient();

  const recentHistory = conversationHistory.slice(-4);
  const messages: MessageParam[] = recentHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));
  messages.push({ role: 'user', content: userMessage });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: buildClassificationPrompt(TOOLS, userConfig ?? null),
    messages,
  });

  const textBlock = response.content.find(
    (block): block is TextBlock => block.type === 'text'
  );
  const responseText = textBlock?.text || '';

  try {
    return JSON.parse(responseText) as { needsAsyncWork: boolean; immediateResponse: string };
  } catch {
    return {
      needsAsyncWork: true,
      immediateResponse: "✨ Let me work on that for you!",
    };
  }
}
