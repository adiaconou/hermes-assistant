/**
 * LLM Integration Module
 *
 * This module handles all communication with the Anthropic Claude API.
 * It provides two main functions:
 *
 * 1. `classifyMessage()` - Fast classification to determine if async processing is needed
 * 2. `generateResponse()` - Full response generation with tool support
 *
 * ## Anthropic API Concepts Used
 *
 * ### Message Structure
 * Messages are sent as an array with `role` ('user' | 'assistant') and `content`.
 * Content can be a string or an array of content blocks.
 *
 * ### Content Block Types
 * - `text`: Plain text content { type: 'text', text: string }
 * - `tool_use`: Claude requesting to call a tool { type: 'tool_use', id, name, input }
 * - `tool_result`: Result of a tool execution { type: 'tool_result', tool_use_id, content }
 *
 * ### Stop Reasons
 * - `end_turn`: Claude finished naturally - extract text and return
 * - `tool_use`: Claude wants to call tool(s) - execute them and continue
 * - `max_tokens`: Response was truncated (hit token limit)
 *
 * ### Tool Loop Flow
 * ```
 * 1. Send messages with tools enabled
 * 2. If stop_reason === 'tool_use':
 *    a. Extract tool_use blocks from response.content
 *    b. Execute each tool
 *    c. Create tool_result blocks with matching tool_use_id
 *    d. Append assistant response to messages
 *    e. Append tool results as a user message
 *    f. Call API again, repeat until end_turn
 * 3. Extract final text block and return
 * ```
 */

// Anthropic SDK Types:
// - Tool: Definition of a tool Claude can use (name, description, input_schema)
// - ToolUseBlock: Claude's request to use a tool { type: 'tool_use', id, name, input }
// - TextBlock: Text content in a response { type: 'text', text }
// - MessageParam: A message in the conversation { role, content }
// - ToolResultBlockParam: Result sent back to Claude { type: 'tool_result', tool_use_id, content }
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
 * Quickly classify a message to determine if async processing is needed.
 *
 * This is a "fast path" call that:
 * - Uses fewer tokens (max_tokens: 512)
 * - Has NO tools enabled (faster response)
 * - Only looks at recent history (last 4 messages)
 *
 * The classification determines whether to:
 * - Return an immediate response (simple queries, greetings)
 * - Trigger async processing (tool use needed, complex requests)
 *
 * @param userMessage - The incoming message to classify
 * @param conversationHistory - Recent conversation for context
 * @param userConfig - User's config (name, timezone) for personalization
 * @returns ClassificationResult with needsAsyncWork flag and immediateResponse
 *
 * @example
 * const result = await classifyMessage("Hi!", history, config);
 * // { needsAsyncWork: false, immediateResponse: "Hello! How can I help?" }
 *
 * @example
 * const result = await classifyMessage("What's on my calendar?", history, config);
 * // { needsAsyncWork: true, immediateResponse: "Let me check your calendar..." }
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
    // API Request Structure:
    // - model: Which Claude model to use
    // - max_tokens: Maximum tokens in the response (keep low for speed)
    // - system: System prompt with instructions (no tools for classification)
    // - messages: Array of { role, content } representing the conversation
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: buildClassificationPrompt(TOOLS, userConfig ?? null),
      messages,
    });

    // Response Structure:
    // - response.content: Array of content blocks (TextBlock, ToolUseBlock, etc.)
    // - response.stop_reason: Why Claude stopped ('end_turn', 'tool_use', 'max_tokens')
    //
    // For classification, we only expect text blocks (no tools enabled)
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
 * Generate a full response using Claude with tool support.
 *
 * This is the main response generation function that:
 * - Sends the full conversation history
 * - Enables all tools (calendar, email, memory, scheduling, etc.)
 * - Handles the tool use loop (up to MAX_TOOL_LOOPS iterations)
 * - Returns the final text response
 *
 * ## Tool Loop Explained
 *
 * When Claude needs to use a tool:
 * 1. API returns with stop_reason: 'tool_use'
 * 2. response.content contains ToolUseBlock(s) with { id, name, input }
 * 3. We execute each tool and collect results
 * 4. Results are sent back as tool_result blocks with matching tool_use_id
 * 5. Claude processes results and either uses more tools or returns final text
 *
 * ## Message Flow Example
 *
 * ```
 * Initial: [{ role: 'user', content: 'What events tomorrow?' }]
 *
 * After tool use:
 * [
 *   { role: 'user', content: 'What events tomorrow?' },
 *   { role: 'assistant', content: [TextBlock, ToolUseBlock] },  // Claude's response
 *   { role: 'user', content: [ToolResultBlock] }                // Tool results
 * ]
 * ```
 *
 * @param userMessage - The user's message to respond to
 * @param conversationHistory - Previous messages for context
 * @param phoneNumber - User's phone number (used for tool context and memory lookup)
 * @param userConfig - User's stored configuration (name, timezone)
 * @param options - Optional overrides for system prompt, tools, and channel
 * @returns The final text response from Claude
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

  // ============================================================================
  // INITIAL API CALL
  // ============================================================================
  console.log(JSON.stringify({
    level: 'info',
    message: 'Calling Anthropic API',
    messageCount: messages.length,
    timestamp: new Date().toISOString(),
  }));

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
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

  // ============================================================================
  // TOOL USE LOOP
  // ============================================================================
  // When stop_reason === 'tool_use', Claude is requesting to execute tools.
  // We must:
  // 1. Extract the tool_use blocks from response.content
  // 2. Execute each tool with its input
  // 3. Build tool_result blocks with the results
  // 4. Send results back to Claude and get next response
  // 5. Repeat until stop_reason === 'end_turn' (or hit loop limit)
  // ============================================================================
  let loopCount = 0;
  const MAX_TOOL_LOOPS = 5; // Safety limit to prevent infinite loops
  let lastToolResults: ToolResultBlockParam[] | null = null;

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

    // Extract ToolUseBlocks from response
    // Each block has: { type: 'tool_use', id: string, name: string, input: object }
    const toolUseBlocks = response.content.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use'
    );

    // Execute all tools in parallel and build result blocks
    // Each result must have tool_use_id matching the original tool_use block's id
    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        // Execute the tool handler with the input Claude provided
        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          toolContext
        );
        // Build the result block - MUST include tool_use_id so Claude knows
        // which tool call this result corresponds to
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,  // Links result to the tool_use request
          content: result,          // JSON string with the tool's output
        };
      })
    );
    lastToolResults = toolResults;

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

    // Append the conversation for the next API call:
    // 1. Add Claude's response (with tool_use blocks) as an assistant message
    // 2. Add tool results as a user message (this is how the API expects them)
    //
    // Note: Tool results are sent with role: 'user' even though they're from tools.
    // This is the Anthropic API convention - tool results are "user" messages.
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
      max_tokens: 16000,
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

  // ============================================================================
  // EXTRACT FINAL RESPONSE
  // ============================================================================
  // After the tool loop completes (stop_reason === 'end_turn'), extract the
  // text content from response.content. The content array may contain multiple
  // blocks; we find the text block specifically.
  // ============================================================================
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

  if (textBlock?.text && textBlock.text.trim().length > 0) {
    return textBlock.text;
  }

  // Fallback: If Claude didn't produce a text response (rare), try to
  // recover something useful from the last tool results. This handles cases
  // like UI generation where the shortUrl is the main output.
  if (lastToolResults) {
    for (const toolResult of lastToolResults) {
      try {
        const parsed = JSON.parse(toolResult.content as string) as {
          success?: boolean;
          shortUrl?: string;
          error?: string;
        };

        if (parsed?.shortUrl) {
          return `Here is your editor link: ${parsed.shortUrl}`;
        }
        if (parsed?.error) {
          return `I could not complete that request: ${parsed.error}`;
        }
      } catch {
        // Ignore parse errors and fall through to default message.
      }
    }
  }

  return 'I could not generate a response.';
}
