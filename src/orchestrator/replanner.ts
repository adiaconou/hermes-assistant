/**
 * Replanner Module
 *
 * Implements dynamic replanning for when steps fail or return unexpected results.
 * This allows the orchestrator to adapt to failures rather than failing the
 * entire request.
 *
 * Key responsibilities:
 * - Preserve completed steps (don't redo work)
 * - Adjust remaining steps based on failures
 * - Track replan count to prevent infinite loops
 */

import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';

import { getClient } from '../services/anthropic/client.js';
import type {
  ExecutionPlan,
  PlanStep,
  PlanContext,
  AgentRegistry,
} from './types.js';
import { ORCHESTRATOR_LIMITS } from './types.js';
import { formatAgentsForPrompt } from '../executor/registry.js';

/**
 * Replanning prompt template.
 * Provides context about what failed and asks for a revised plan.
 */
const REPLANNING_PROMPT = `You are revising an execution plan after a step failure or unexpected result.

<available_agents>
{agents}
</available_agents>

<original_request>
{request}
</original_request>

<original_goal>
{goal}
</original_goal>

<prior_steps>
{steps}
</prior_steps>

<errors>
{errors}
</errors>

<rules>
1. Keep completed steps - don't redo work that succeeded
2. Adjust or remove failed/pending steps as needed
3. Add new steps if necessary to achieve the goal
4. If the goal cannot be achieved, create a plan that handles the failure gracefully
5. Maximum {maxSteps} total steps
</rules>

<output_format>
Respond with ONLY a JSON object (no markdown):
{
  "analysis": "Brief analysis of what went wrong and how to fix it",
  "steps": [
    {
      "id": "step_1",
      "agent": "agent-name",
      "task": "Task description",
      "status": "completed" // or "pending" for new steps
    }
  ]
}
</output_format>`;

/**
 * Format prior steps for the replanning prompt.
 */
function formatPriorSteps(steps: PlanStep[]): string {
  return steps
    .map(step => {
      const resultInfo = step.result
        ? `\n    Result: ${step.result.success ? 'SUCCESS' : 'FAILED'}${step.result.error ? ` - ${step.result.error}` : ''}`
        : '';
      const outputInfo = step.result?.output
        ? `\n    Output: ${JSON.stringify(step.result.output).substring(0, 200)}`
        : '';

      return `  - [${step.id}] ${step.agent} (${step.status})
    Task: ${step.task}${resultInfo}${outputInfo}`;
    })
    .join('\n');
}

/**
 * Format errors for the replanning prompt.
 */
function formatErrors(errors: Array<{ stepId: string; error: string }>): string {
  if (errors.length === 0) {
    return '(No errors recorded)';
  }

  return errors
    .map(e => `  - [${e.stepId}] ${e.error}`)
    .join('\n');
}

/**
 * Parse the LLM's replan response.
 */
function parseReplanResponse(text: string): {
  analysis: string;
  steps: Array<{ id: string; agent: string; task: string; status?: string }>;
} {
  // Try to extract JSON from markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to parse replan response',
      text: text.substring(0, 500),
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));

    // Return empty plan on parse failure
    return {
      analysis: 'Could not parse replan response',
      steps: [],
    };
  }
}

/**
 * Check if replanning is allowed.
 */
export function canReplan(plan: ExecutionPlan): boolean {
  const withinReplanLimit = plan.version < ORCHESTRATOR_LIMITS.maxReplans + 1;
  const withinStepLimit = plan.steps.length < ORCHESTRATOR_LIMITS.maxTotalSteps;
  const withinTimeLimit =
    Date.now() - plan.createdAt.getTime() < ORCHESTRATOR_LIMITS.maxExecutionTimeMs;

  return withinReplanLimit && withinStepLimit && withinTimeLimit;
}

/**
 * Create a revised plan based on execution failures.
 *
 * @param priorPlan The plan that needs revision
 * @param context Current plan context with errors
 * @param registry Agent registry for available agents
 * @returns Revised ExecutionPlan
 */
export async function replan(
  priorPlan: ExecutionPlan,
  context: PlanContext,
  registry: AgentRegistry
): Promise<ExecutionPlan> {
  const anthropic = getClient();
  const startTime = Date.now();

  console.log(JSON.stringify({
    level: 'info',
    message: 'Starting replan',
    planId: priorPlan.id,
    version: priorPlan.version,
    errorCount: context.errors.length,
    timestamp: new Date().toISOString(),
  }));

  // Build the replanning prompt
  const agentDescriptions = formatAgentsForPrompt(registry);
  const stepsText = formatPriorSteps(priorPlan.steps);
  const errorsText = formatErrors(context.errors);

  const prompt = REPLANNING_PROMPT
    .replace('{agents}', agentDescriptions)
    .replace('{request}', priorPlan.userRequest)
    .replace('{goal}', priorPlan.goal)
    .replace('{steps}', stepsText)
    .replace('{errors}', errorsText)
    .replace('{maxSteps}', String(ORCHESTRATOR_LIMITS.maxTotalSteps));

  // Call LLM for revised plan
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    temperature: 0,
    system: prompt,
    messages: [
      { role: 'user', content: 'Create a revised plan to handle the failures.' },
    ],
  });

  // Extract text response
  const textBlock = response.content.find(
    (block): block is TextBlock => block.type === 'text'
  );
  const responseText = textBlock?.text || '';

  // Parse the revised plan
  const parsed = parseReplanResponse(responseText);

  // Get completed steps from the prior plan (preserve their results)
  const completedSteps = priorPlan.steps.filter(s => s.status === 'completed');

  // Build new step list: completed steps + new/revised steps
  const newSteps: PlanStep[] = [];

  // Add completed steps first (preserving their results)
  for (const completedStep of completedSteps) {
    newSteps.push({ ...completedStep });
  }

  // Add new/revised steps from the LLM response
  for (const parsedStep of parsed.steps) {
    // Skip if this is a completed step we already have
    if (parsedStep.status === 'completed') {
      continue;
    }

    // Check for duplicates
    const isDuplicate = newSteps.some(
      s => s.agent === parsedStep.agent && s.task === parsedStep.task
    );

    if (!isDuplicate) {
      newSteps.push({
        id: parsedStep.id || `step_${newSteps.length + 1}_v${priorPlan.version + 1}`,
        agent: parsedStep.agent,
        task: parsedStep.task,
        status: 'pending',
        retryCount: 0,
        maxRetries: 2,
      });
    }
  }

  // Enforce overall step cap (C-3)
  if (newSteps.length > ORCHESTRATOR_LIMITS.maxTotalSteps) {
    newSteps.splice(ORCHESTRATOR_LIMITS.maxTotalSteps);
  }

  // Create the revised plan
  const revisedPlan: ExecutionPlan = {
    ...priorPlan,
    steps: newSteps,
    status: 'executing',
    version: priorPlan.version + 1,
    updatedAt: new Date(),
  };

  console.log(JSON.stringify({
    level: 'info',
    message: 'Replan completed',
    planId: revisedPlan.id,
    version: revisedPlan.version,
    completedStepCount: completedSteps.length,
    newStepCount: newSteps.length - completedSteps.length,
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  }));

  return revisedPlan;
}
