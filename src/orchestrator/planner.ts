/**
 * Planner Module
 *
 * Creates execution plans from user requests. The planner analyzes the user's
 * message, resolves dates/times, and generates an ordered list of steps to
 * accomplish the user's goal.
 *
 * Key responsibilities:
 * - Analyze user intent
 * - Resolve relative dates before creating steps
 * - Select appropriate agents for each step
 * - Embed resolved values in task descriptions
 */

import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';

import { getClient } from '../services/anthropic/client.js';
import { buildTimeContext, buildUserContext } from '../services/anthropic/prompts/context.js';
import { resolveDate } from '../services/date/resolver.js';
import type {
  ExecutionPlan,
  PlanStep,
  PlanContext,
  AgentRegistry,
} from './types.js';
import { ORCHESTRATOR_LIMITS } from './types.js';
import { formatAgentsForPrompt } from '../executor/registry.js';
import { formatHistoryForPrompt } from './conversation-window.js';

/**
 * Planning prompt template.
 * Instructs the LLM to analyze the request and create an execution plan.
 */
const PLANNING_PROMPT = `You are a planning module for a personal assistant.

Analyze the user's request and create a plan with sequential steps.

<current_time>
{timeContext}
</current_time>

<available_agents>
{agents}
</available_agents>

<user_context>
{userContext}
</user_context>

<conversation_history>
{history}
</conversation_history>

<rules>
1. Use the MINIMUM number of steps needed - prefer fewer steps
2. For simple requests (greetings, questions, single actions), use 1 step with general-agent
3. Only use multiple steps when truly necessary (e.g., "check calendar AND create reminder")
4. Each step should be a discrete, completable task
5. Steps execute sequentially - later steps can reference earlier results
6. Maximum 10 steps per plan
7. If dates/times are relative (tomorrow, friday, next week), resolve them to specific dates in the task description
8. Today is {today}
</rules>

<output_format>
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "analysis": "Brief analysis of what the user wants",
  "goal": "One sentence describing the goal",
  "steps": [
    {
      "id": "step_1",
      "agent": "agent-name",
      "task": "Specific task with resolved dates (e.g., 'List events on 2026-01-30' not 'List events on friday')"
    }
  ]
}

For simple requests, return a single step:
{
  "analysis": "User wants to know about their calendar tomorrow",
  "goal": "Show tomorrow's calendar events",
  "steps": [
    {
      "id": "step_1",
      "agent": "general-agent",
      "task": "List all calendar events for 2026-01-30 (tomorrow)"
    }
  ]
}
</output_format>`;

/**
 * Parse the LLM's plan response.
 * Handles both clean JSON and JSON embedded in markdown.
 */
function parsePlanResponse(
  text: string,
  userMessage: string
): {
  analysis: string;
  goal: string;
  steps: Array<{ id: string; agent: string; task: string }>;
} {
  // Try to extract JSON from markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to parse plan response',
      text: text.substring(0, 500),
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));

    // Return a default single-step plan
    return {
      analysis: 'Could not parse plan, defaulting to general agent',
      goal: 'Handle user request',
      steps: [{
        id: 'step_1',
        agent: 'general-agent',
        task: `Handle the user request directly: "${userMessage}"`,
      }],
    };
  }
}

/**
 * Create an execution plan from a user message.
 *
 * @param context Plan context with user message, history, memory, config
 * @param registry Agent registry for available agents
 * @returns ExecutionPlan ready for execution
 */
export async function createPlan(
  context: PlanContext,
  registry: AgentRegistry
): Promise<ExecutionPlan> {
  const anthropic = getClient();
  const startTime = Date.now();

  // Build prompt components
  const timeContext = buildTimeContext(context.userConfig);
  const agentDescriptions = formatAgentsForPrompt(registry);
  const historyText = formatHistoryForPrompt(context.conversationHistory);

  // Build user context with memory
  let memoryXml = '';
  if (context.userFacts.length > 0) {
    const factsText = context.userFacts.map(f => f.fact).join('. ') + '.';
    memoryXml = `\n  <facts>\n    ${factsText}\n  </facts>`;
  }
  const userContextText = buildUserContext(context.userConfig, memoryXml);

  // Get today's date in user's timezone for the prompt
  const timezone = context.userConfig?.timezone || 'UTC';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

  // Build the prompt
  const prompt = PLANNING_PROMPT
    .replace('{timeContext}', timeContext)
    .replace('{agents}', agentDescriptions)
    .replace('{userContext}', userContextText)
    .replace('{history}', historyText)
    .replace('{today}', today);

  console.log(JSON.stringify({
    level: 'info',
    message: 'Creating execution plan',
    userMessageLength: context.userMessage.length,
    historyLength: context.conversationHistory.length,
    factsCount: context.userFacts.length,
    timestamp: new Date().toISOString(),
  }));

  // Call LLM to create plan
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    temperature: 0, // Deterministic planning (NFR-4)
    system: prompt,
    messages: [
      { role: 'user', content: context.userMessage },
    ],
  });

  // Extract text response
  const textBlock = response.content.find(
    (block): block is TextBlock => block.type === 'text'
  );
  const responseText = textBlock?.text || '';

  // Parse the plan
  const parsed = parsePlanResponse(responseText, context.userMessage);

  // Convert to PlanSteps
  const steps: PlanStep[] = parsed.steps.map((s, i) => ({
    id: s.id || `step_${i + 1}`,
    agent: s.agent,
    task: s.task,
    status: 'pending' as const,
    retryCount: 0,
    maxRetries: 2,
  }));

  // Enforce maximum total steps (C-3) for the initial plan as well
  const cappedSteps =
    steps.length > ORCHESTRATOR_LIMITS.maxTotalSteps
      ? steps.slice(0, ORCHESTRATOR_LIMITS.maxTotalSteps)
      : steps;

  // Create the plan
  const now = new Date();
  const plan: ExecutionPlan = {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userRequest: context.userMessage,
    goal: parsed.goal,
    steps: cappedSteps,
    status: 'executing',
    context,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  console.log(JSON.stringify({
    level: 'info',
    message: 'Plan created',
    planId: plan.id,
    goal: plan.goal,
    stepCount: steps.length,
    agents: steps.map(s => s.agent),
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  }));

  return plan;
}

/**
 * Resolve relative dates in a task description.
 * Used by the orchestrator to ensure dates are consistent across steps.
 *
 * @param task Task description that may contain relative dates
 * @param timezone User's timezone
 * @returns Task with resolved dates
 */
export function resolveTaskDates(task: string, timezone: string): string {
  // Common relative date patterns
  const patterns = [
    'tomorrow',
    'today',
    'yesterday',
    'this week',
    'next week',
    'this month',
    'next month',
    /next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
  ];

  let resolvedTask = task;

  for (const pattern of patterns) {
    const regex = typeof pattern === 'string'
      ? new RegExp(`\\b${pattern}\\b`, 'gi')
      : pattern;

    const matches = task.match(regex);
    if (matches) {
      for (const match of matches) {
        const resolved = resolveDate(match, { timezone, forwardDate: true });
        if (resolved) {
          // Replace with ISO date and original term
          resolvedTask = resolvedTask.replace(
            match,
            `${resolved.iso.split('T')[0]} (${match})`
          );
        }
      }
    }
  }

  return resolvedTask;
}
