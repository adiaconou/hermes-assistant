/**
 * Response Composer
 *
 * Synthesizes the final user-facing response from the execution results.
 * This takes all step outputs and creates a coherent, conversational message.
 */

import type {
  TextBlock,
  ToolUseBlock,
  ToolResultBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/messages';

import { getClient } from '../services/anthropic/client.js';
import { buildUserMemoryXml } from '../services/anthropic/prompts/context.js';
import { formatMapsLink, executeTool } from '../tools/index.js';
import type { ExecutionPlan, PlanContext, StepResult } from './types.js';
import type { TraceLogger } from '../utils/trace-logger.js';

/**
 * Composition prompt template.
 */
const COMPOSITION_PROMPT = `You are composing a final text message response for a personal assistant.

The user's request has been processed. Write a warm, direct reply.

<user_request>
{request}
</user_request>

<goal>
{goal}
</goal>

<step_results>
{results}
</step_results>

{errorContext}

{dataPriority}

<rules>
1. TONE: Warm and casual, like texting a friend. Have personality but don't be wordy.
2. LEAD WITH THE OUTCOME: Start with what was done or found. No preamble.
3. KEEP INFORMATIONAL CONTENT: Details, lists, specifics about what changed — include all of this. This is the valuable part.
4. CUT THE FLUFF:
   - No filler openers ("Got it!", "Sure thing!", "Absolutely!", "One sec...")
   - No repeating back what the user asked ("You asked me to...")
   - No closing offers ("Let me know if you need anything else!", "Want me to...")
   - No process narration ("I went ahead and...", "I searched for...")
5. Aim for under 800 characters. Informational details are worth the space; filler is not.
6. Don't mention internal steps or technical details
7. If there were partial failures, acknowledge what succeeded and what didn't
8. If there's a URL or link in the results, include it prominently
9. Use the user's name if available, but not every time
10. CRITICAL: If the user asked for specific numbers, amounts, prices, dates, or quantities, you MUST include ALL of them in your response. Never summarize numerical data away.
11. When mentioning a physical address or location from the results, use the format_maps_link tool and include its "text" field (Label: URL). Avoid markdown; use plain URLs.
</rules>

Write ONLY the final text message. No JSON, no explanation.`;

/**
 * Format step results for the composition prompt.
 */
const MAX_RESULT_OUTPUT_CHARS = 2000;

function formatStepResults(stepResults: Record<string, StepResult>): string {
  const entries = Object.entries(stepResults);

  if (entries.length === 0) {
    return '(No step results)';
  }

  return entries
    .map(([stepId, result]) => {
      const status = result.success ? 'SUCCESS' : 'FAILED';
      const rawOutput = result.output
        ? typeof result.output === 'string'
          ? result.output
          : JSON.stringify(result.output)
        : '(no output)';
      const output = rawOutput.length > MAX_RESULT_OUTPUT_CHARS
        ? `${rawOutput.slice(0, MAX_RESULT_OUTPUT_CHARS)}...(truncated)`
        : rawOutput;
      const error = result.error ? `\n    Error: ${result.error}` : '';

      return `  - [${stepId}] ${status}
    Output: ${output}${error}`;
    })
    .join('\n');
}

/**
 * Synthesize a final response from the execution results.
 *
 * @param context Plan context with all information
 * @param plan The executed plan
 * @param failureReason Optional reason for failure
 * @param logger Trace logger for debugging
 * @returns User-friendly response string
 */
export async function synthesizeResponse(
  context: PlanContext,
  plan: ExecutionPlan,
  failureReason?: 'timeout' | 'step_failed',
  logger?: TraceLogger
): Promise<string> {
  const anthropic = getClient();

  // Build error context if there was a failure
  let errorContext = '';
  if (failureReason === 'timeout') {
    errorContext = `<error>
The request timed out before completing all steps. Some actions may have succeeded.
</error>`;
  } else if (failureReason === 'step_failed') {
    const failedSteps = plan.steps.filter(s => s.status === 'failed');
    const errors = failedSteps.map(s => s.result?.error || 'Unknown error').join(', ');
    errorContext = `<error>
Some steps failed: ${errors}
Explain what succeeded and what didn't.
</error>`;
  }

  // Detect if user is asking for specific data (amounts, quantities, etc.)
  const dataPatterns = /how much|how many|what (is|was|were|are) the (amount|price|cost|total|balance|number)|list all|show me all|what did .* cost/i;
  const isDataQuestion = dataPatterns.test(context.userMessage);
  const dataPriority = isDataQuestion
    ? '<response_priority>\nThe user is asking for SPECIFIC DATA. Include ALL numbers, amounts, and values from the results. Do not summarize them.\n</response_priority>'
    : '';

  // Build the composition prompt
  const resultsText = formatStepResults(context.stepResults);
  const prompt = COMPOSITION_PROMPT
    .replace('{request}', context.userMessage)
    .replace('{goal}', plan.goal)
    .replace('{results}', resultsText)
    .replace('{errorContext}', errorContext)
    .replace('{dataPriority}', dataPriority);
  const memoryXml = buildUserMemoryXml(context.userFacts, { maxFacts: 20, maxChars: 1500 });
  const promptWithMemory = memoryXml
    ? `${prompt}\n\n${memoryXml}`
    : prompt;

  // Add user name context if available
  let systemAddition = '';
  if (context.userConfig?.name) {
    systemAddition = `\n\nThe user's name is ${context.userConfig.name}. Use it naturally if appropriate.`;
  }

  try {
    // Tools available for composition (just maps for now)
    const tools = [formatMapsLink.tool];

    // Build tool context for execution
    const toolContext = {
      phoneNumber: context.phoneNumber,
      channel: context.channel,
      userConfig: context.userConfig,
    };

    // Log LLM request
    logger?.llmRequest('composition', {
      model: 'claude-opus-4-5-20251101',
      maxTokens: 350,
      systemPrompt: promptWithMemory + systemAddition,
      messages: [{ role: 'user', content: 'Compose the final response.' }],
      tools: tools.map(t => ({ name: t.name })),
    });

    const messages: MessageParam[] = [
      { role: 'user', content: 'Compose the final response.' },
    ];

    let llmStartTime = Date.now();
    let response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 350,
      system: promptWithMemory + systemAddition,
      tools,
      messages,
    });

    // Log LLM response
    logger?.llmResponse('composition', {
      stopReason: response.stop_reason ?? 'unknown',
      content: response.content,
      usage: response.usage ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      } : undefined,
    }, Date.now() - llmStartTime);

    // Handle tool calls (allow up to 2 iterations for multiple addresses)
    let toolIterations = 0;
    const maxToolIterations = 2;

    while (response.stop_reason === 'tool_use' && toolIterations < maxToolIterations) {
      toolIterations++;

      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      // Execute all tool calls in parallel, isolating individual failures
      const toolResults: ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          logger?.log('DEBUG', 'Composition tool call', {
            tool: toolUse.name,
            input: toolUse.input,
          });

          try {
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
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger?.log('ERROR', 'Composition tool call failed', {
              tool: toolUse.name,
              error: errorMsg,
            });

            return {
              type: 'tool_result' as const,
              tool_use_id: toolUse.id,
              content: JSON.stringify({ success: false, error: errorMsg }),
              is_error: true as const,
            };
          }
        })
      );

      // Continue conversation with tool results
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      logger?.llmRequest(`composition: tool iteration ${toolIterations}`, {
        model: 'claude-opus-4-5-20251101',
        maxTokens: 350,
        systemPrompt: '(same as initial)',
        messages: [{ role: 'user', content: '(continuing with tool results)' }],
      });

      llmStartTime = Date.now();
      response = await anthropic.messages.create({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 350,
        system: promptWithMemory + systemAddition,
        tools,
        messages,
      });

      logger?.llmResponse(`composition: tool iteration ${toolIterations}`, {
        stopReason: response.stop_reason ?? 'unknown',
        content: response.content,
        usage: response.usage ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        } : undefined,
      }, Date.now() - llmStartTime);
    }

    const textBlock = response.content.find(
      (block): block is TextBlock => block.type === 'text'
    );

    const finalResponse = textBlock?.text || 'I completed your request.';
    logger?.log('INFO', 'Response composed', {
      Length: finalResponse.length,
      toolIterations,
    });

    return finalResponse;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to synthesize response',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));

    // Fallback response
    if (failureReason) {
      return 'I encountered some issues completing your request. Please try again.';
    }

    // Try to extract something useful from the results
    const outputs = Object.values(context.stepResults)
      .filter(r => r.success && r.output)
      .map(r => {
        if (typeof r.output === 'string') return r.output;
        if (typeof r.output === 'object' && r.output !== null) {
          const obj = r.output as Record<string, unknown>;
          if (obj.shortUrl) return `Here's your link: ${obj.shortUrl}`;
          if (obj.message) return String(obj.message);
        }
        return null;
      })
      .filter(Boolean);

    if (outputs.length > 0) {
      return outputs.join('\n\n');
    }

    return 'Done! Let me know if you need anything else.';
  }
}
