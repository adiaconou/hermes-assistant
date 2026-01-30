/**
 * Tool Executor
 *
 * Provides a reusable function for executing LLM calls with tool access.
 * This is the core agentic loop that all specialized agents use.
 *
 * Centralizing this logic ensures consistent:
 * - Tool handling
 * - Error formatting
 * - Token tracking
 * - Loop limits
 */

import type {
  Tool,
  ToolUseBlock,
  TextBlock,
  MessageParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';

import { getClient } from '../services/anthropic/client.js';
import { TOOLS, executeTool } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import type { StepResult, AgentExecutionContext } from './types.js';

/** Maximum tool loop iterations to prevent infinite loops */
const MAX_TOOL_LOOPS = 5;

/** Maximum tokens for agent responses (shared loop) */
const MAX_TOKENS = 12000;

/**
 * Get tools by name, or all tools if '*' is specified.
 */
function resolveTools(toolNames: string[]): Tool[] {
  if (toolNames.includes('*')) {
    return TOOLS;
  }

  return TOOLS.filter(tool => toolNames.includes(tool.name));
}

/**
 * Format previous step results into a compact XML block for prompting.
 */
function formatPreviousStepResults(
  results: Record<string, StepResult>
): string {
  const entries = Object.entries(results);
  if (entries.length === 0) return '(No previous step results)';

  return entries
    .map(([stepId, result]) => {
      const status = result.success ? 'success' : 'failed';
      const output = result.output
        ? typeof result.output === 'string'
          ? result.output.slice(0, 400)
          : JSON.stringify(result.output).slice(0, 400)
        : '';
      const error = result.error ? ` error="${result.error}"` : '';
      return `<step id="${stepId}" status="${status}"${error}>${output}</step>`;
    })
    .join('\n');
}

/**
 * Execute a task with tool access using the LLM.
 *
 * This function runs a complete tool loop:
 * 1. Send initial message to LLM with tools enabled
 * 2. If LLM requests tool use, execute tools and send results back
 * 3. Repeat until LLM returns a final text response
 *
 * @param systemPrompt Agent-specific system prompt
 * @param task The task description from the plan step
 * @param toolNames List of tool names this agent can use ('*' for all)
 * @param context Execution context with user info and previous results
 * @returns StepResult with success/output/error and observability data
 */
export async function executeWithTools(
  systemPrompt: string,
  task: string,
  toolNames: string[],
  context: AgentExecutionContext,
  options?: { initialMessages?: MessageParam[] }
): Promise<StepResult> {
  const anthropic = getClient();
  const tools = resolveTools(toolNames);

  // Build tool context for handlers
  const toolContext: ToolContext = {
    phoneNumber: context.phoneNumber,
    channel: context.channel,
    userConfig: context.userConfig,
  };

  // Build initial messages
  const previousResultsXml = formatPreviousStepResults(context.previousStepResults);
  const baseUserContent = `Task: ${task}\n\n<previous_results>\n${previousResultsXml}\n</previous_results>`;

  // Use provided messages (e.g., full conversation) or default to the task-only message
  const messages: MessageParam[] = options?.initialMessages ?? [
    { role: 'user', content: baseUserContent },
  ];

  // Track all tool calls for observability
  const allToolCalls: ToolUseBlock[] = [];

  // Track token usage
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Initial API call
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages,
    });

    // Track usage
    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;

    // Tool use loop
    let loopCount = 0;

    while (response.stop_reason === 'tool_use') {
      loopCount++;

      if (loopCount > MAX_TOOL_LOOPS) {
        console.warn(JSON.stringify({
          level: 'warn',
          message: 'Agent tool loop limit reached',
          loopCount,
          timestamp: new Date().toISOString(),
        }));

        return {
          success: false,
          output: null,
          error: `Tool loop limit exceeded (${MAX_TOOL_LOOPS})`,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          tokenUsage: {
            input: totalInputTokens,
            output: totalOutputTokens,
          },
        };
      }

      // Extract tool use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      // Track for observability
      allToolCalls.push(...toolUseBlocks);

      // Execute all tools in parallel
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

      // Append to conversation
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      // Continue conversation
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools,
        messages,
      });

      // Track usage
      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;
    }

    // Extract final text response
    const textBlock = response.content.find(
      (block): block is TextBlock => block.type === 'text'
    );

    const output = textBlock?.text ?? '';

    // Try to parse output as JSON if it looks like JSON
    let parsedOutput: unknown = output;
    if (output.trim().startsWith('{') || output.trim().startsWith('[')) {
      try {
        parsedOutput = JSON.parse(output);
      } catch {
        // Keep as string if not valid JSON
      }
    }

    return {
      success: true,
      output: parsedOutput,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      tokenUsage: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
    };
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Agent execution failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));

    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : String(error),
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      tokenUsage: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
    };
  }
}

/**
 * Format previous step results for inclusion in agent prompts.
 * This provides context from earlier steps in the execution plan.
 */
export function formatPreviousResults(
  results: Record<string, unknown>
): string {
  const entries = Object.entries(results);

  if (entries.length === 0) {
    return '(No previous step results)';
  }

  return entries
    .map(([stepId, result]) => {
      const formatted = typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);
      return `<step id="${stepId}">\n${formatted}\n</step>`;
    })
    .join('\n\n');
}
