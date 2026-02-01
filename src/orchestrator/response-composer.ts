/**
 * Response Composer
 *
 * Synthesizes the final user-facing response from the execution results.
 * This takes all step outputs and creates a coherent, conversational message.
 */

import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';

import { getClient } from '../services/anthropic/client.js';
import { buildUserMemoryXml } from '../services/anthropic/prompts/context.js';
import type { ExecutionPlan, PlanContext, StepResult } from './types.js';
import type { TraceLogger } from '../utils/trace-logger.js';

/**
 * Composition prompt template.
 */
const COMPOSITION_PROMPT = `You are composing a final response for a personal assistant.

The user's request has been processed. Create a friendly, conversational response
that summarizes what was done.

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

<rules>
1. Be conversational and friendly
2. Response MUST be under 1000 characters - summarize if needed
3. Don't mention internal steps or technical details
4. If there were partial failures, acknowledge what succeeded and what didn't
5. If there's a URL or link in the results, include it prominently
6. Use the user's name if available
</rules>

Write ONLY the final response message (no JSON, no explanation).`;

/**
 * Format step results for the composition prompt.
 */
const MAX_RESULT_OUTPUT_CHARS = 500;

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

  // Build the composition prompt
  const resultsText = formatStepResults(context.stepResults);
  const prompt = COMPOSITION_PROMPT
    .replace('{request}', context.userMessage)
    .replace('{goal}', plan.goal)
    .replace('{results}', resultsText)
    .replace('{errorContext}', errorContext);
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
    // Log LLM request
    logger?.llmRequest('composition', {
      model: 'claude-opus-4-5-20251101',
      maxTokens: 512,
      systemPrompt: promptWithMemory + systemAddition,
      messages: [{ role: 'user', content: 'Compose the final response.' }],
    });

    const llmStartTime = Date.now();
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 512,
      system: promptWithMemory + systemAddition,
      messages: [
        { role: 'user', content: 'Compose the final response.' },
      ],
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

    const textBlock = response.content.find(
      (block): block is TextBlock => block.type === 'text'
    );

    const finalResponse = textBlock?.text || 'I completed your request.';
    logger?.log('INFO', 'Response composed', { Length: finalResponse.length });

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
