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

import config from '../config.js';
import { getClient } from '../services/anthropic/client.js';
import { buildTimeContext, buildUserContext } from '../services/anthropic/prompts/context.js';
import { resolveDate, resolveDateRange } from '../services/date/resolver.js';
import type {
  ExecutionPlan,
  PlanStep,
  PlanContext,
  AgentRegistry,
  PlanStepTargetType,
} from './types.js';
import { ORCHESTRATOR_LIMITS } from './types.js';
import { formatAgentsForPrompt } from '../executor/registry.js';
import { formatHistoryForPrompt } from './conversation-window.js';
import { formatCurrentMediaContext } from './media-context.js';
import { getSkillsRegistry } from '../registry/skills.js';
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

{skillCatalog}

<user_context>
{userContext}
</user_context>

<conversation_history>
{history}
</conversation_history>

{currentMedia}

{mediaContext}

<rules>
1. Use the MINIMUM number of steps needed - prefer fewer steps
2. For any request that reaches this planner, pick the best-fit specialized agent. Greetings and small talk are already handled before this planner runs.
3. For single-domain actionable requests, use the matching specialized agent (calendar/email/drive/scheduler/memory/ui)
4. Only use multiple steps when truly necessary (e.g., "check calendar AND create reminder")
5. Each step should be a discrete, completable task
6. Steps execute sequentially - later steps can reference earlier results
7. Maximum 10 steps per plan
8. If dates/times are relative (tomorrow, friday, next week), resolve them to specific dates in the task description
9. Today is {today}
10. Memory tasks (store/recall/update/delete user facts) should use memory-agent
11. Data flow: Some agents can fetch data but not display it richly; others can display but not fetch. When a user wants data displayed interactively:
   - First step: Use an agent that can fetch the data (e.g., calendar-agent, email-agent)
   - Second step: Pass the data to ui-agent to render it interactively
   - Example: "Show my calendar in a visual dashboard" → step 1: calendar-agent fetches events, step 2: ui-agent renders them
12. The ui-agent has NO network access - it can only render data provided to it from previous steps or create standalone tools (calculators, forms, timers)
13. If <current_media> exists, resolve "this/that/it" to current-turn media before conversation history.
14. Intent priority: explicit user text first, then <current_media>, then history. If the request is media-only or still ambiguous, create one memory-agent step that asks a concise clarification question.
15. Skills vs agents: Prefer a SKILL when the task matches a structured workflow (extraction, checklists, transforms, reports). Prefer an AGENT when the task needs open-ended domain reasoning or complex tool orchestration. If a skill matches the request well, use "targetType": "skill".
16. If <media_context> exists, the user may reference previously analyzed images. Route to the appropriate agent (usually drive-agent) rather than asking a clarification question.
</rules>

<output_format>
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "analysis": "Brief analysis of what the user wants",
  "goal": "One sentence describing the goal",
  "steps": [
    {
      "id": "step_1",
      "targetType": "agent",
      "agent": "agent-name",
      "task": "Specific task with resolved dates"
    }
  ]
}

Each step must include "targetType": either "agent" (for domain agents) or "skill" (for filesystem skills).
When targetType is "skill", the "agent" field should contain the skill name instead.

For simple requests, return a single step:
{
  "analysis": "User wants to know about their calendar tomorrow",
  "goal": "Show tomorrow's calendar events",
  "steps": [
    {
      "id": "step_1",
      "targetType": "agent",
      "agent": "calendar-agent",
      "task": "List all calendar events for 2026-01-30 (tomorrow)"
    }
  ]
}
</output_format>`;

type ParsedPlanResponse = {
  analysis: string;
  goal: string;
  steps: Array<{ id: string; targetType?: PlanStepTargetType; agent: string; task: string }>;
};

function createFallbackPlan(userMessage: string, reason: string, timezone?: string): ParsedPlanResponse {
  console.warn(JSON.stringify({
    level: 'warn',
    message: 'Falling back to memory-agent plan',
    fallbackReason: reason,
    timestamp: new Date().toISOString(),
  }));

  // Resolve relative dates even in fallback plans so the agent
  // doesn't have to interpret "tomorrow", "next week", etc.
  const resolvedMessage = timezone
    ? resolveTaskDates(userMessage, timezone)
    : userMessage;

  return {
    analysis: 'Could not parse planner output, falling back to memory-agent',
    goal: 'Handle user request',
    steps: [{
      id: 'step_1',
      targetType: 'agent',
      agent: 'memory-agent',
      task: `Check for relevant stored context and handle the user request: "${resolvedMessage}"`,
    }],
  };
}

/**
 * Parse the LLM's plan response.
 * Handles both clean JSON and JSON embedded in markdown.
 */
function parsePlanResponse(text: string): ParsedPlanResponse | null {
  // Try to extract JSON from markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonText);
    // Boundary: validate shape before use
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.steps)) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Plan response missing valid steps array',
        timestamp: new Date().toISOString(),
      }));
      return null;
    }
    return parsed as ParsedPlanResponse;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to parse plan response',
      text: text.substring(0, 500),
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return null;
  }
}

/**
 * Format the skill catalog for planner context.
 * Uses compact metadata only — no full SKILL.md bodies.
 */
function formatSkillCatalogForPrompt(channel: 'sms' | 'whatsapp'): string {
  const skillsRegistry = getSkillsRegistry();
  const skills = skillsRegistry
    .list()
    .filter(s => s.enabled && s.channels.includes(channel));

  if (skills.length === 0) {
    return '';
  }

  const entries = skills.map(s => {
    const channels = `\n    Channels: ${s.channels.join(', ')}`;
    const hints = s.matchHints.length > 0 ? `\n    Triggers: ${s.matchHints.join(', ')}` : '';
    const tools = s.tools.length > 0 ? `\n    Tools: ${s.tools.join(', ')}` : '';
    return `  - ${s.name}: ${s.description}${channels}${hints}${tools}`;
  }).join('\n');

  return `<available_skills>\n${entries}\n</available_skills>`;
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

  // Build user context with memory (cap at 4000 chars to prevent context overflow)
  let memoryXml = '';
  if (context.userFacts.length > 0) {
    const MAX_FACTS_CHARS = 4000;
    let factsText = '';
    for (const f of context.userFacts) {
      const next = factsText ? factsText + '. ' + f.fact : f.fact;
      if (next.length > MAX_FACTS_CHARS) break;
      factsText = next;
    }
    factsText += '.';
    memoryXml = `\n  <facts>\n    ${factsText}\n  </facts>`;
  }
  const userContextText = buildUserContext(context.userConfig, memoryXml);

  // Get today's date in user's timezone for the prompt
  const timezone = context.userConfig?.timezone || 'UTC';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

  // Build current-turn media context (if pre-analysis is available)
  const currentMediaBlock = context.currentMediaSummaries
    ? formatCurrentMediaContext(context.currentMediaSummaries)
    : '';

  // Build skill catalog for planner context
  const skillCatalogBlock = formatSkillCatalogForPrompt(context.channel);

  // Build the prompt
  const prompt = PLANNING_PROMPT
    .replace('{timeContext}', timeContext)
    .replace('{agents}', agentDescriptions)
    .replace('{skillCatalog}', skillCatalogBlock)
    .replace('{userContext}', userContextText)
    .replace('{history}', historyText)
    .replace('{currentMedia}', currentMediaBlock)
    .replace('{mediaContext}', context.mediaContext || '')
    .replace('{today}', today);

  console.log(JSON.stringify({
    level: 'info',
    message: 'Creating execution plan',
    userMessageLength: context.userMessage.length,
    historyLength: context.conversationHistory.length,
    factsCount: context.userFacts.length,
    currentMediaSummaries: context.currentMediaSummaries?.length || 0,
    timestamp: new Date().toISOString(),
  }));

  // Log LLM request
  logger?.llmRequest('planning', {
    model: config.models.planner,
    maxTokens: 1024,
    temperature: 0,
    systemPrompt: prompt,
    messages: [{ role: 'user', content: context.userMessage }],
  });

  // Call LLM to create plan
  const llmStartTime = Date.now();
  const response = await anthropic.messages.create({
    model: config.models.planner,
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

  // Parse the plan, falling back to memory-agent on parse failure
  let parsed = parsePlanResponse(responseText);
  if (!parsed) {
    parsed = createFallbackPlan(context.userMessage, 'planning_parse_failed', context.userConfig?.timezone);
  }

  // Validate parsed steps structure
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    parsed = createFallbackPlan(context.userMessage, 'invalid_steps_structure', context.userConfig?.timezone);
  }

  // Convert to PlanSteps
  const steps: PlanStep[] = parsed.steps
    .filter(s => typeof s.agent === 'string' && s.agent.length > 0 && typeof s.task === 'string' && s.task.length > 0)
    .map((s, i) => ({
      id: s.id || `step_${i + 1}`,
      targetType: (s.targetType === 'skill' ? 'skill' : 'agent') as PlanStepTargetType,
      agent: s.agent,
      task: s.task.length > 500 ? s.task.slice(0, 500) + '...' : s.task,
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
