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
import { resolveDate, resolveDateRange } from '../services/date/resolver.js';
import type {
  ExecutionPlan,
  PlanStep,
  PlanContext,
  AgentRegistry,
} from './types.js';
import { ORCHESTRATOR_LIMITS } from './types.js';
import { formatAgentsForPrompt } from '../executor/registry.js';
import { formatHistoryForPrompt } from './conversation-window.js';
import type { TraceLogger } from '../utils/trace-logger.js';

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
2. For greetings, small talk, gratitude, or ambiguous conversational requests, use 1 step with general-agent
3. For single-domain actionable requests, prefer the matching specialized agent (calendar/email/drive/scheduler/memory/ui) instead of general-agent
4. Only use multiple steps when truly necessary (e.g., "check calendar AND create reminder")
5. Each step should be a discrete, completable task
6. Steps execute sequentially - later steps can reference earlier results
7. Maximum 10 steps per plan
8. If dates/times are relative (tomorrow, friday, next week), resolve them to specific dates in the task description
9. Today is {today}
10. Memory tasks (store/recall/update/delete user facts) should use memory-agent; use general-agent only if no specialized agent fits
11. Data flow: Some agents can fetch data but not display it richly; others can display but not fetch. When a user wants data displayed interactively:
   - First step: Use an agent that can fetch the data (e.g., calendar-agent, email-agent, general-agent)
   - Second step: Pass the data to ui-agent to render it interactively
   - Example: "Show my calendar in a visual dashboard" → step 1: calendar-agent fetches events, step 2: ui-agent renders them
12. The ui-agent has NO network access - it can only render data provided to it from previous steps or create standalone tools (calculators, forms, timers)
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
      "agent": "calendar-agent",
      "task": "List all calendar events for 2026-01-30 (tomorrow)"
    }
  ]
}
</output_format>`;

const PLAN_REPAIR_PROMPT = `You repair malformed planner output into valid JSON.

Return ONLY a JSON object in this format:
{
  "analysis": "Brief analysis",
  "goal": "One sentence goal",
  "steps": [
    {
      "id": "step_1",
      "agent": "agent-name",
      "task": "Specific task"
    }
  ]
}

Rules:
1. Preserve the original user intent
2. Keep steps minimal and sequential
3. Use specialized agents when clearly appropriate; use general-agent only if needed
4. No markdown, no extra commentary`;

type ParsedPlanResponse = {
  analysis: string;
  goal: string;
  steps: Array<{ id: string; agent: string; task: string }>;
};

function createGeneralFallbackPlan(userMessage: string, reason: string, timezone?: string): ParsedPlanResponse {
  console.warn(JSON.stringify({
    level: 'warn',
    message: 'Falling back to general-agent plan',
    fallbackReason: reason,
    timestamp: new Date().toISOString(),
  }));

  // Resolve relative dates even in fallback plans so the general-agent
  // doesn't have to interpret "tomorrow", "next week", etc.
  const resolvedMessage = timezone
    ? resolveTaskDates(userMessage, timezone)
    : userMessage;

  return {
    analysis: 'Could not parse planner output, defaulting to general agent',
    goal: 'Handle user request',
    steps: [{
      id: 'step_1',
      agent: 'general-agent',
      task: `Handle the user request directly: "${resolvedMessage}"`,
    }],
  };
}

/**
 * Parse the LLM's plan response.
 * Handles both clean JSON and JSON embedded in markdown.
 */
function parsePlanResponse(
  text: string,
  stage: 'initial' | 'repair'
): ParsedPlanResponse | null {
  // Try to extract JSON from markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to parse plan response',
      stage,
      text: text.substring(0, 500),
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return null;
  }
}

async function repairPlanResponse(
  anthropic: ReturnType<typeof getClient>,
  userMessage: string,
  malformedPlan: string,
  logger?: TraceLogger
): Promise<ParsedPlanResponse | null> {
  const repairInput = `User request:
${userMessage}

Malformed planner output:
${malformedPlan.substring(0, 4000)}`;

  logger?.llmRequest('planning:repair', {
    model: 'claude-opus-4-5-20251101',
    maxTokens: 1024,
    temperature: 0,
    systemPrompt: PLAN_REPAIR_PROMPT,
    messages: [{ role: 'user', content: repairInput }],
  });

  const llmStartTime = Date.now();
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 1024,
    temperature: 0,
    system: PLAN_REPAIR_PROMPT,
    messages: [{ role: 'user', content: repairInput }],
  });

  logger?.llmResponse('planning:repair', {
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

  return parsePlanResponse(textBlock?.text || '', 'repair');
}

/**
 * Create an execution plan from a user message.
 *
 * @param context Plan context with user message, history, memory, config
 * @param registry Agent registry for available agents
 * @param logger Trace logger for debugging
 * @returns ExecutionPlan ready for execution
 */
export async function createPlan(
  context: PlanContext,
  registry: AgentRegistry,
  logger?: TraceLogger
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

  // Log LLM request
  logger?.llmRequest('planning', {
    model: 'claude-opus-4-5-20251101',
    maxTokens: 1024,
    temperature: 0,
    systemPrompt: prompt,
    messages: [{ role: 'user', content: context.userMessage }],
  });

  // Call LLM to create plan
  const llmStartTime = Date.now();
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 1024,
    temperature: 0, // Deterministic planning (NFR-4)
    system: prompt,
    messages: [
      { role: 'user', content: context.userMessage },
    ],
  });
  const llmDuration = Date.now() - llmStartTime;

  // Log LLM response
  logger?.llmResponse('planning', {
    stopReason: response.stop_reason ?? 'unknown',
    content: response.content,
    usage: response.usage ? {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    } : undefined,
  }, llmDuration);

  // Extract text response
  const textBlock = response.content.find(
    (block): block is TextBlock => block.type === 'text'
  );
  const responseText = textBlock?.text || '';

  // Parse the plan, then attempt one repair pass before falling back
  let parsed = parsePlanResponse(responseText, 'initial');
  if (!parsed) {
    parsed = await repairPlanResponse(anthropic, context.userMessage, responseText, logger);
  }
  if (!parsed) {
    parsed = createGeneralFallbackPlan(context.userMessage, 'planning_parse_failed_after_repair', context.userConfig?.timezone);
  }

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
        const resolvedRange = resolveDateRange(match, { timezone, forwardDate: true });
        if (resolvedRange) {
          resolvedTask = resolvedTask.replace(
            match,
            `${resolvedRange.start.iso.split('T')[0]} to ${resolvedRange.end.iso.split('T')[0]} (${match})`
          );
          continue;
        }

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
