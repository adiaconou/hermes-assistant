/**
 * LLM integration module.
 *
 * Wraps Anthropic SDK for generating responses.
 */

import Anthropic from '@anthropic-ai/sdk';
import config from './config.js';
import type { Message } from './conversation.js';

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

const SYSTEM_PROMPT = `You are a helpful SMS assistant. Keep responses concise since you communicate via SMS. Be direct and helpful.`;

/**
 * Generate a response using Claude.
 */
export async function generateResponse(
  userMessage: string,
  conversationHistory: Message[]
): Promise<string> {
  const anthropic = getClient();

  // Convert history to Anthropic format
  const messages = conversationHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  // Extract text from response
  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.text || 'I could not generate a response.';
}
