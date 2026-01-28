/**
 * LLM integration module.
 *
 * Wraps Anthropic SDK for generating responses with tool support.
 */

import type {
  Tool,
  ToolUseBlock,
  TextBlock,
  MessageParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type { Message } from '../conversation.js';
import type { UserConfig } from '../services/user-config/index.js';

import { getClient } from './client.js';
import {
  SYSTEM_PROMPT,
  buildClassificationPrompt,
  buildTimeContext,
  buildMemoryXml,
  buildUserContext,
} from './prompts/index.js';
import { TOOLS, READ_ONLY_TOOLS, executeTool, type ToolContext } from './tools/index.js';

// Re-export types
export type { ClassificationResult, GenerateOptions, ToolContext, ToolDefinition, ToolHandler } from './types.js';

// Re-export tools for external use
export { TOOLS, READ_ONLY_TOOLS };

// Import types for use in this file
import type { ClassificationResult, GenerateOptions } from './types.js';

/**
 * Quickly classify a message to determine if it needs async processing.
 * This is a fast call without tools to minimize latency.
 */
export async function classifyMessage(
  userMessage: string,
  conversationHistory: Message[],
  userConfig?: UserConfig | null
): Promise<ClassificationResult> {
  const anthropic = getClient();

  // Convert history to Anthropic format (keep it short for speed)
  const recentHistory = conversationHistory.slice(-4);
  const messages: MessageParam[] = recentHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  console.log(JSON.stringify({
    level: 'info',
    message: 'Classifying message',
    messageLength: userMessage.length,
    timestamp: new Date().toISOString(),
  }));

  const startTime = Date.now();

  try {
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

    console.log(JSON.stringify({
      level: 'info',
      message: 'Classification response received',
      durationMs: Date.now() - startTime,
      responseLength: responseText.length,
      timestamp: new Date().toISOString(),
    }));

    // Parse JSON response
    const parsed = JSON.parse(responseText) as ClassificationResult;

    console.log(JSON.stringify({
      level: 'info',
      message: 'Classification result',
      needsAsyncWork: parsed.needsAsyncWork,
      immediateResponseLength: parsed.immediateResponse.length,
      timestamp: new Date().toISOString(),
    }));

    return parsed;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Classification failed, defaulting to async',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Default to async processing with a generic ack on failure
    return {
      needsAsyncWork: true,
      immediateResponse: "✨ Let me work on that for you!",
    };
  }
}

/**
 * Generate a response using Claude with tool support.
 * @param userMessage - The user's message
 * @param conversationHistory - Previous conversation messages
 * @param phoneNumber - User's phone number (for calendar tools)
 * @param userConfig - User's stored configuration (name, timezone)
 * @param options - Optional overrides for system prompt and tools
 */
export async function generateResponse(
  userMessage: string,
  conversationHistory: Message[],
  phoneNumber?: string,
  userConfig?: UserConfig | null,
  options?: GenerateOptions
): Promise<string> {
  const anthropic = getClient();

  // Convert history to Anthropic format
  const messages: MessageParam[] = conversationHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  // Build memory XML if phone number available
  let memoryXml: string | undefined;
  if (phoneNumber) {
    console.log(JSON.stringify({
      level: 'info',
      message: 'Starting conversation - loading user memory',
      phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
      timestamp: new Date().toISOString(),
    }));

    memoryXml = await buildMemoryXml(phoneNumber);
  }

  // Build system prompt - use provided or build default with user context and memory
  const timeContext = buildTimeContext(userConfig ?? null);
  let systemPrompt = options?.systemPrompt
    ?? (`**${timeContext}**\n\n` + SYSTEM_PROMPT + buildUserContext(userConfig ?? null, memoryXml));

  // Use provided tools or default
  const tools = options?.tools ?? TOOLS;

  // Build tool context
  const toolContext: ToolContext = {
    phoneNumber,
    channel: options?.channel,
    userConfig,
  };

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
    system: systemPrompt,
    tools,
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
  const MAX_TOOL_LOOPS = 5;

  while (response.stop_reason === 'tool_use') {
    loopCount++;

    if (loopCount > MAX_TOOL_LOOPS) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Tool loop limit reached',
        loopCount,
        timestamp: new Date().toISOString(),
      }));
      break;
    }

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
        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          toolContext
        );
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: result,
        };
      })
    );

    // Check if any tool updated memory
    let memoryWasUpdated = false;
    for (const toolResult of toolResults) {
      try {
        const parsed = JSON.parse(toolResult.content as string);
        if (parsed.memory_updated === true) {
          memoryWasUpdated = true;
          break;
        }
      } catch {
        // Not JSON or doesn't have memory_updated - skip
      }
    }

    // Reload memory if updated
    if (memoryWasUpdated && phoneNumber) {
      console.log(JSON.stringify({
        level: 'info',
        message: 'Memory updated, reloading for same conversation',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        timestamp: new Date().toISOString(),
      }));

      memoryXml = await buildMemoryXml(phoneNumber);
      const newTimeContext = buildTimeContext(userConfig ?? null);
      systemPrompt = options?.systemPrompt
        ?? (`**${newTimeContext}**\n\n` + SYSTEM_PROMPT + buildUserContext(userConfig ?? null, memoryXml));
    }

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
      system: systemPrompt,
      tools,
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
