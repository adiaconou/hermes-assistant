# Orchestrator Implementation Plan

This document provides a step-by-step implementation plan for the orchestrator system defined in [orchestrator-design.md](orchestrator-design.md).

## Overview

The implementation follows a phased approach that allows incremental development and testing without requiring all agents upfront.

| Phase | Focus | Outcome |
|-------|-------|---------|
| 1 | Core Orchestrator + General Agent | Planning/execution works with single agent |
| 2 | First Specialized Agents | Multi-step plans work |
| 3 | Remaining Agents | Full agent coverage |

---

## Prerequisites

Before starting implementation, ensure these foundations are in place:

### Required Infrastructure
- [ ] LLM client configured (Claude API)
- [ ] User memory system (facts storage/retrieval)
- [ ] Conversation history storage
- [ ] Tool registry with existing tools

### Recommended Reading
- [orchestrator-design.md](orchestrator-design.md) - Full design specification
- [agent-design.md](agent-design.md) - Agent structure and conventions

---

## Phase 1: Core Orchestrator + General Agent

**Goal**: Get the orchestrator running with a single "general-agent" that wraps the existing system.

### Step 1.1: Define Core Types

**Purpose**: Establish the foundational type system that all orchestrator components will use. These types encode the plan/step state machine and context management requirements from the design doc.

**Prerequisites**: None - this is the starting point.

**Key Design Decisions**:
- `StepStatus` uses a simple state machine: `pending` → `running` → `completed|failed` (see design doc "Plan Step States" diagram)
- `StepResult` captures both success/failure AND token usage for budget tracking (NFR-2, NFR-3)
- `PlanContext` accumulates results progressively so later steps can access earlier outputs (FR-5)
- `ExecutionPlan.version` tracks replans for the max-replans limit (C-2)

**Relevant Requirements**: FR-1 through FR-5, NFR-2, NFR-3, C-1 through C-5

**Acceptance Criteria**:
- [ ] All types compile without errors
- [ ] Types support the state transitions shown in the design doc
- [ ] `PlanContext.stepResults` is keyed by step ID for O(1) lookup
- [ ] `ConversationWindowConfig` has sensible defaults matching the design doc (24h, 20 messages, 4000 tokens)

**Gotchas**:
- Don't make `output` in `StepResult` typed as `string` - it needs to be `unknown` to support structured data from agents
- Include `toolCalls` in `StepResult` for debugging/observability even though it's optional
- `maxRetries` on `PlanStep` should default to 2 (C-4) but be overridable per-step

Create `src/orchestrator/types.ts`:

```typescript
// Step and plan types
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface StepResult {
  success: boolean;
  output: unknown; // structured output from agent/tool loop
  toolCalls?: ToolCall[];
  error?: string;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

export interface PlanStep {
  id: string;
  agent: string;
  task: string;
  status: StepStatus;
  result?: StepResult;
  retryCount: number;
  maxRetries: number;
}

export interface ExecutionPlan {
  id: string;
  userRequest: string;
  goal: string;
  steps: PlanStep[];
  status: 'planning' | 'executing' | 'replanning' | 'completed' | 'failed';
  context: PlanContext;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// Context types
export interface PlanContext {
  userMessage: string;
  conversationHistory: Message[];
  userMemory: UserFacts;
  stepResults: Record<string, StepResult>;
  errors: Array<{ stepId: string; error: string }>;
}

export interface ConversationWindowConfig {
  maxAgeHours: number;
  maxMessages: number;
  maxTokens: number;
}

// Agent registry types
export interface AgentCapability {
  name: string;
  description: string;
  tools: string[];
  examples: string[];
  outputSchema?: {
    type: string;
    properties: Record<string, unknown>;
  };
}

export interface AgentRegistry {
  agents: Map<string, AgentCapability>;
  getAgent(name: string): AgentCapability | undefined;
  listAgents(): AgentCapability[];
}
```

### Step 1.2: Create Agent Registry

**Purpose**: Create a centralized registry for agent definitions that the orchestrator uses during planning (to select agents) and execution (to look up agent configs). This enables NFR-6: adding a new agent only requires a registry entry.

**Prerequisites**: Step 1.1 (types must exist)

**Key Design Decisions**:
- Registry is a simple in-memory Map - no database needed since agent definitions are static
- `tools: ['*']` for general-agent means "all tools" - this is a special case
- Agent descriptions are written for the LLM planner to understand capabilities
- Examples help the planner understand when to use each agent

**Relevant Requirements**: NFR-6 (Extensibility), the "Agent Registry" section of the design doc

**Acceptance Criteria**:
- [ ] `getAgent()` returns undefined for unknown agents (not throws)
- [ ] `listAgents()` returns all agents for building the planning prompt
- [ ] general-agent is registered and marked as the fallback
- [ ] Descriptions are clear enough for the LLM to make good routing decisions

**Gotchas**:
- Keep descriptions concise but specific - the LLM will see these in every planning call
- Don't include implementation details in descriptions - focus on capabilities
- The registry will grow in Phase 2/3; design the interface to be stable

Create `src/orchestrator/agent-registry.ts`:

```typescript
import { AgentCapability, AgentRegistry } from './types';

const agents: AgentCapability[] = [
  {
    name: 'general-agent',
    description: 'Handles all tasks using the full tool suite. Use when no specialized agent fits.',
    tools: ['*'], // All tools
    examples: [
      'General questions and conversations',
      'Tasks spanning multiple domains',
      'Fallback for unclassified requests',
    ],
  },
];

export function createAgentRegistry(): AgentRegistry {
  const agentMap = new Map(agents.map(a => [a.name, a]));

  return {
    agents: agentMap,
    getAgent: (name) => agentMap.get(name),
    listAgents: () => [...agentMap.values()],
  };
}
```

### Step 1.3: Implement Conversation Window

**Purpose**: Filter conversation history to a manageable window that fits within token budgets while preserving relevant context. This addresses the "Session Problem" from the design doc - SMS/WhatsApp has no sessions, so we use a sliding window.

**Prerequisites**: Step 1.1 (Message type from types.ts)

**Key Design Decisions**:
- Three-constraint filtering: age (24h) → count (20 msgs) → tokens (4000) applied in order
- Newest messages are prioritized when truncating (most relevant context)
- Token estimation uses simple 4-chars-per-token heuristic (good enough for planning)
- Messages are returned in chronological order (oldest first) for natural conversation flow

**Relevant Requirements**: "Conversation History Window" section, CTX-6 (Context Size Limits)

**Acceptance Criteria**:
- [ ] Returns empty array for no messages
- [ ] Respects maxAgeHours cutoff
- [ ] Respects maxMessages limit, keeping newest
- [ ] Respects maxTokens limit, dropping oldest messages
- [ ] Returned messages are in chronological order (not reverse)
- [ ] Default config matches design doc values

**Gotchas**:
- Messages need a `timestamp` field - verify this exists in the existing Message type
- The token estimation is approximate; monitor if context overflows occur in production
- Consider that message content could be very long (e.g., email summaries) - the token limit is critical
- Sort stability: when messages have same timestamp, preserve original order

Create `src/orchestrator/conversation-window.ts`:

```typescript
import { ConversationWindowConfig, Message } from './types';

const DEFAULT_CONFIG: ConversationWindowConfig = {
  maxAgeHours: 24,
  maxMessages: 20,
  maxTokens: 4000,
};

export function getRelevantHistory(
  messages: Message[],
  config: ConversationWindowConfig = DEFAULT_CONFIG
): Message[] {
  const cutoffTime = Date.now() - (config.maxAgeHours * 60 * 60 * 1000);

  // Filter by age
  let filtered = messages.filter(m => m.timestamp >= cutoffTime);

  // Sort newest first, take most recent N
  filtered = filtered
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, config.maxMessages);

  // Reverse back to chronological order
  filtered = filtered.reverse();

  // Trim to token budget (simple approximation: 4 chars ≈ 1 token)
  let totalTokens = 0;
  const result: Message[] = [];

  for (const msg of filtered) {
    const msgTokens = Math.ceil(msg.content.length / 4);
    if (totalTokens + msgTokens > config.maxTokens) break;
    result.push(msg);
    totalTokens += msgTokens;
  }

  return result;
}
```

### Step 1.4: Build Planner Module

**Purpose**: The planner is the "brain" of the orchestrator - it analyzes user requests and creates execution plans. This implements Phase 1 of the orchestrator flow (Planning). The planner has access to utility tools (resolve_date, etc.) to ensure date consistency across steps.

**Prerequisites**:
- Step 1.1 (types)
- Step 1.2 (agent registry for agent descriptions)
- Existing utility tools: `resolve_date`, `resolve_time_range` from `src/llm/tools/resolve-date.ts`

**Key Design Decisions**:
- Planner uses LLM with utility tools enabled (not just a completion call)
- Resolved dates are embedded in task descriptions, not passed as metadata - ensures sub-agents see concrete values
- `resolvedValues` in output is for debugging/logging, not used at runtime
- temperature=0 for deterministic planning (NFR-4)
- Planning prompt includes user memory so preferences can be incorporated into task descriptions

**Relevant Requirements**:
- UT-1 (Date Resolution), UT-2 (Consistency)
- FR-7 (Memory Isolation) - orchestrator sees full memory, sub-agents don't
- NFR-4 (Best-Effort Determinism)
- "Phase 1: Planning" in design doc

**Acceptance Criteria**:
- [ ] Creates valid ExecutionPlan from user message
- [ ] Resolves relative dates before creating steps (test with "tomorrow", "friday", "next week")
- [ ] Embeds resolved dates in step task descriptions (not the original relative terms)
- [ ] Uses appropriate agents based on request type
- [ ] Returns single-step plan for simple requests
- [ ] Returns multi-step plan for complex requests
- [ ] Handles case where no steps needed (greeting/simple question)

**Gotchas**:
- The LLM might return invalid JSON - add robust parsing with error handling
- Test edge cases: requests with multiple date references, ambiguous dates ("next Friday" vs "this Friday")
- Empty plan (0 steps) is valid for greetings - don't treat as error
- Memory formatting should match the XML format from `buildMemoryXml()` in existing code

Create `src/orchestrator/planner.ts`:

```typescript
import { ExecutionPlan, PlanContext, PlanStep } from './types';
import { AgentRegistry } from './agent-registry';

const PLANNING_PROMPT = `You are a planning module for a personal assistant.

Analyze the user's request and create a plan with sequential steps.

<utility_tools>
You can call these tools BEFORE writing the plan:
- resolve_date: convert relative dates ("friday", "next tuesday") to ISO dates
- resolve_time_range: convert ranges ("this week") to start/end timestamps
- get_current_time: get current time in user's timezone

If the request includes relative dates/times:
1) Call the appropriate utility tool(s)
2) Embed resolved values in step tasks
3) Include resolvedValues in the JSON output
</utility_tools>

<available_agents>
{agents}
</available_agents>

<user_memory>
{memory}
</user_memory>

<conversation_history>
{history}
</conversation_history>

<user_request>
{request}
</user_request>

Respond with a JSON plan:
{
  "analysis": "Brief analysis of what the user wants",
  "resolvedValues": {
    "dates": { "friday": "2026-01-30" },
    "timeRanges": {}
  },
  "goal": "Brief description of what we're accomplishing",
  "steps": [
    {
      "id": "step_1",
      "agent": "agent-name",
      "task": "Specific task description for this agent (with resolved dates)"
    }
  ]
}

Rules:
- ALWAYS resolve relative dates before creating the plan
- Embed resolved values in task descriptions (no relative terms)
- Use the minimum number of steps necessary
- Each step should be a discrete, completable task
- Steps execute sequentially - later steps can use earlier results
- Maximum 10 steps per plan`;

export async function createPlan(
  context: PlanContext,
  registry: AgentRegistry,
  llmClient: LLMClient
): Promise<ExecutionPlan> {
  const agentDescriptions = registry.listAgents()
    .map(a => `- ${a.name}: ${a.description}`)
    .join('\n');

  const prompt = PLANNING_PROMPT
    .replace('{agents}', agentDescriptions)
    .replace('{memory}', formatMemory(context.userMemory))
    .replace('{history}', formatHistory(context.conversationHistory))
    .replace('{request}', context.userMessage);

  const response = await llmClient.completeWithTools(prompt, {
    tools: ['resolve_date', 'resolve_time_range', 'get_current_time'],
    temperature: 0,
  });
  const parsed = JSON.parse(response);

  const steps: PlanStep[] = parsed.steps.map((s: any, i: number) => ({
    id: s.id ?? `step_${i + 1}`,
    agent: s.agent,
    task: s.task,
    status: 'pending',
    retryCount: 0,
    maxRetries: 2,
  }));

  const now = new Date();
  const planId = `plan_${Date.now()}`;
  return {
    id: planId,
    userRequest: context.userMessage,
    goal: parsed.goal,
    steps,
    status: 'executing',
    context,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
```

### Step 1.4b: Add Replanning

**Purpose**: Implement dynamic replanning for when steps fail or return unexpected results. This is a core differentiator of the orchestrator - it can adapt to failures rather than just failing the whole request. Implements FR-2 (Dynamic Replanning).

**Prerequisites**:
- Step 1.4 (planner for shared types/patterns)
- Understanding of when replanning triggers (see design doc "When to Replan")

**Key Design Decisions**:
- Completed steps are preserved - we don't redo work that succeeded
- Failed/pending steps can be replaced or removed in the revised plan
- Replan uses the same LLM with context about what failed and why
- Replan prompt includes prior step results so LLM knows what data is available
- Version counter tracks replans for the C-2 limit (max 3 replans)

**Relevant Requirements**:
- FR-2 (Dynamic Replanning)
- FR-3 (Partial Success) - return results from successful steps even if replan fails
- C-2 (Max replans per request: 3)
- "Dynamic Replanning" section of design doc

**Acceptance Criteria**:
- [ ] Preserves completed steps in revised plan
- [ ] Removes or replaces failed steps appropriately
- [ ] Increments plan version number
- [ ] Respects max replans limit (returns error after 3 replans)
- [ ] New steps get fresh IDs to avoid conflicts
- [ ] Doesn't duplicate completed work (same agent + task = skip)

**Gotchas**:
- Replanning should be relatively quick - use a focused prompt, not the full planning prompt
- Watch for infinite replan loops (step fails → replan → same step fails → replan...)
- The `mergeSteps` logic needs careful testing with edge cases
- Consider what happens if LLM returns steps that reference non-existent prior results

Create `src/orchestrator/replanner.ts`:

```typescript
import { ExecutionPlan, PlanContext, PlanStep } from './types';
import { AgentRegistry } from './agent-registry';

const REPLANNING_PROMPT = `You are replanning after a step failure or empty result.

<available_agents>
{agents}
</available_agents>

<user_request>
{request}
</user_request>

<prior_steps>
{steps}
</prior_steps>

<errors>
{errors}
</errors>

Respond with a JSON plan that:
- Preserves completed steps
- Includes completed step status/result in the new plan output
- Adjusts remaining steps to handle failures or missing data
- Uses resolved dates/times from prior plan tasks
- If you include completed steps, keep them at the start of the list in original order
`;

export async function replan(
  priorPlan: ExecutionPlan,
  context: PlanContext,
  registry: AgentRegistry,
  llmClient: LLMClient
): Promise<ExecutionPlan> {
  const agentDescriptions = registry.listAgents()
    .map(a => `- ${a.name}: ${a.description}`)
    .join('\n');

  const prompt = REPLANNING_PROMPT
    .replace('{agents}', agentDescriptions)
    .replace('{request}', context.userMessage)
    .replace('{steps}', JSON.stringify(priorPlan.steps, null, 2))
    .replace('{errors}', JSON.stringify(context.errors, null, 2));

  const response = await llmClient.complete(prompt);
  const parsed = JSON.parse(response);

  const parsedSteps: PlanStep[] = parsed.steps.map((s: any) => ({
    id: s.id,
    agent: s.agent,
    task: s.task,
    status: s.status ?? 'pending',
    retryCount: 0,
    maxRetries: 2,
  }));

  const completed = priorPlan.steps.filter(s => s.status === 'completed');
  const remaining = parsedSteps.filter(
    s => s.status !== 'completed' && !completed.find(c => c.id === s.id)
  );
  const steps = [...completed, ...remaining].map(step => ({
    ...step,
    result: step.result ?? priorPlan.steps.find(p => p.id === step.id)?.result,
  }));

  return {
    ...priorPlan,
    steps,
    status: 'replanning',
    version: priorPlan.version + 1,
    updatedAt: new Date(),
  };
}
```

### Step 1.5: Implement Step Executor

**Purpose**: Execute individual plan steps by invoking the appropriate agent. This is the bridge between the orchestrator's planning and the agents' tool-calling capabilities. Each step runs in isolation with only its assigned tools, and each step uses a tool loop (model -> tool -> model) until completion.

**Prerequisites**:
- Step 1.1 (types)
- Step 1.2 (agent registry to look up agent config)
- Step 1.5a (execute-with-tools helper - implement first or in parallel)

**Key Design Decisions**:
- Per-step timeout (C-5: 60 seconds) prevents a single step from hanging the whole plan
- Context from previous steps is formatted as structured XML/JSON for clarity
- Unknown agents fall back gracefully (return error, don't throw)
- The executor doesn't retry - that's handled by the orchestrator loop
- Step prompt includes previous results so agents can use outputs from earlier steps (FR-5)
- Each agent execution is a single tool-enabled LLM loop (multiple tool calls allowed), not a separate planning system

**Relevant Requirements**:
- FR-4 (Agent Isolation) - agents don't communicate directly
- FR-5 (Context Passing) - previous step results available to subsequent steps
- FR-8 (Task-Only Context) - sub-agents only see task + previous outputs, not conversation history
- C-5 (Step timeout: 60 seconds)
- "Sub-Agent Context Structure" section of design doc

**Acceptance Criteria**:
- [ ] Executes step using correct agent
- [ ] Times out after 60 seconds with clear error
- [ ] Returns structured StepResult with success/output/error
- [ ] Passes previous step results as context
- [ ] Handles unknown agent gracefully (error, not crash)
- [ ] Includes token usage in result when available

**Gotchas**:
- `Promise.race` for timeout needs proper cleanup of the timed-out promise
- The prompt should be concise - agents have their own system prompts
- Format previous results consistently (JSON in XML tags works well)
- Consider what happens when previous step output is very large - may need truncation

Create `src/orchestrator/executor.ts`:

```typescript
import { ExecutionPlan, PlanStep, StepResult, PlanContext } from './types';
import { AgentRegistry } from './agent-registry';
import { executeWithTools } from '../agents/execute-with-tools';

const STEP_TIMEOUT_MS = 60_000;

export async function executeStep(
  step: PlanStep,
  context: PlanContext,
  registry: AgentRegistry,
  llmClient: LLMClient
): Promise<StepResult> {
  const agent = registry.getAgent(step.agent);
  if (!agent) {
    return { success: false, output: null, error: `Unknown agent: ${step.agent}` };
  }

  const stepPrompt = buildStepPrompt(step, context, agent);

  try {
    const raw = await Promise.race([
      executeWithTools(stepPrompt, step.task, agent.tools, llmClient),
      timeout(STEP_TIMEOUT_MS),
    ]);

    const result = typeof raw === 'string' ? { output: raw } : raw;
    return {
      success: result.success ?? !result.error,
      output: result.output ?? null,
      toolCalls: result.toolCalls,
      error: result.error,
      tokenUsage: result.tokenUsage,
    };
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function buildStepPrompt(
  step: PlanStep,
  context: PlanContext,
  agent: AgentCapability
): string {
  const previousResults = Object.entries(context.stepResults)
    .map(([stepId, result]) =>
      `Step ${stepId} result: ${JSON.stringify({ success: result.success, output: result.output, error: result.error })}`
    )
    .join('\n');

  return `You are the ${agent.name}.

<task>
${step.task}
</task>

<previous_step_results>
${previousResults || 'None - this is the first step'}
</previous_step_results>

Complete the task. Be concise and focused.`;
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Step timeout')), ms)
  );
}
```

### Step 1.5a: Shared Agent Tool Helper (Tool Loop)

**Purpose**: Provide a reusable function for executing LLM calls with tool access. This is the core agentic loop that all specialized agents will use. Centralizing this logic ensures consistent tool handling, error formatting, and token tracking.

**Prerequisites**:
- Existing LLM client (`src/llm/` - already exists)
- Existing tool definitions (already exist in `src/llm/tools/`)

**Key Design Decisions**:
- This function wraps the existing `handleMessage` or similar LLM call logic
- Returns a structured `StepResult` that the executor expects
- Handles the tool-calling loop internally (agent may call multiple tools)
- Tracks token usage for budget management
- Should work with different tool subsets (not always all tools)

**Relevant Requirements**:
- FR-4 (Agent Isolation) - tools are scoped per agent
- NFR-2 (Observability) - structured logging of tool calls
- "Agent Registry" section showing each agent has specific tools

**Acceptance Criteria**:
- [ ] Executes LLM call with specified tools
- [ ] Handles multi-turn tool calling (tool call → result → tool call → ...)
- [ ] Returns structured StepResult
- [ ] Respects tool subset (doesn't expose tools not in the list)
- [ ] Captures token usage metrics
- [ ] Works for both `['*']` (all tools) and specific tool lists

**Gotchas**:
- This may overlap with existing `handleMessage` logic - consider refactoring to share code
- The `['*']` case needs special handling to mean "all available tools"
- Ensure tool errors are captured as structured errors, not thrown exceptions
- Consider tool call limits to prevent runaway tool loops

Create `src/agents/execute-with-tools.ts`:

```typescript
export async function executeWithTools(
  systemPrompt: string,
  task: string,
  tools: string[],
  llmClient: LLMClient
): Promise<StepResult> {
  // Tool loop: model -> tool(s) -> model until completion
  let response = await llmClient.completeWithTools(systemPrompt, {
    tools,
    input: task,
  });

  while (response.toolCalls?.length) {
    const toolResults = await runTools(response.toolCalls);
    response = await llmClient.completeWithTools(systemPrompt, {
      tools,
      input: task,
      toolResults,
    });
  }

  return response;
}
```

### Step 1.6: Create Main Orchestrator

**Purpose**: The main orchestrator function that ties everything together: creates plans, executes steps sequentially, handles retries/replanning, and returns final results. This is the primary entry point for the orchestration system.

**Prerequisites**:
- All previous Phase 1 steps (1.1-1.5a)
- Understanding of the full orchestration flow from the design doc

**Key Design Decisions**:
- Plan-level timeout (C-1: 2 minutes) enforced throughout execution
- Steps execute strictly sequentially (FR-1) - no parallelization
- Retry logic is at the orchestrator level, not step level (easier to track/limit)
- Structured JSON logging for all state transitions (NFR-2)
- Returns partial results even on failure (FR-3, NFR-5)

**Relevant Requirements**:
- FR-1 (Sequential Execution)
- FR-3 (Partial Success)
- FR-6 (Retry Support)
- NFR-1 through NFR-5
- C-1 through C-4
- "Orchestrator Flow" section of design doc

**Acceptance Criteria**:
- [ ] Creates plan from user message
- [ ] Executes steps in order, one at a time
- [ ] Retries failed steps up to maxRetries times
- [ ] Triggers replan when appropriate (step failure after retries exhausted)
- [ ] Respects plan-level timeout (2 minutes)
- [ ] Returns partial results on timeout/failure
- [ ] Logs all plan/step state transitions as structured JSON
- [ ] Returns synthesized response on success

**Gotchas**:
- Time checking should happen at start of each step, not just end
- Careful with the step index after replanning - completed steps should be skipped
- `synthesizeResponse` is a placeholder - may need a separate LLM call for response composition
- Consider what happens when replan returns 0 new steps (should complete successfully)
- The logging format should be consistent and parseable for debugging

Create `src/orchestrator/index.ts`:

```typescript
import { ExecutionPlan, PlanContext, StepResult } from './types';
import { createAgentRegistry } from './agent-registry';
import { createPlan } from './planner';
import { executeStep } from './executor';
import { getRelevantHistory } from './conversation-window';
import { replan } from './replanner';

const ORCHESTRATOR_LIMITS = {
  maxExecutionTimeMs: 120_000,
  maxReplans: 3,
  maxTotalSteps: 10,
  maxRetriesPerStep: 2,
  stepTimeoutMs: 60_000,
};

export async function orchestrate(
  userMessage: string,
  conversationHistory: Message[],
  userMemory: UserFacts,
  llmClient: LLMClient
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const registry = createAgentRegistry();

  const context: PlanContext = {
    userMessage,
    conversationHistory: getRelevantHistory(conversationHistory),
    userMemory,
    stepResults: {},
    errors: [],
  };

  // Create initial plan
  let plan = await createPlan(context, registry, llmClient);
  logPlanEvent('plan_created', plan);

  // Execute steps sequentially
  let currentStepIndex = 0;
  while (currentStepIndex < plan.steps.length) {
    // Check time limit
    if (Date.now() - startTime > ORCHESTRATOR_LIMITS.maxExecutionTimeMs) {
      logPlanEvent('plan_timeout', plan);
      return { success: false, error: 'Execution timeout', partialResults: context.stepResults };
    }

    const step = plan.steps[currentStepIndex];
    step.status = 'running';
    logStepEvent('step_started', plan, step);

  const result = await executeStep(step, context, registry, llmClient);

    if (!result.success || result.error) {
      const errorMessage = result.error ?? 'Step failed';
      // Handle failure
      step.retryCount++;
      context.errors.push({ stepId: step.id, error: errorMessage });
      logStepEvent('step_failed', plan, step, { ...result, error: errorMessage });
      if (step.retryCount >= step.maxRetries) {
        // Try replanning
        if (plan.version < ORCHESTRATOR_LIMITS.maxReplans + 1) {
          plan = await replan(plan, context, registry, llmClient);
          logPlanEvent('plan_replanned', plan);
          plan.status = 'executing';
          currentStepIndex = plan.steps.findIndex(s => s.status !== 'completed');
          if (currentStepIndex < 0) {
            break;
          }
          continue;
        }
        step.status = 'failed';
        logPlanEvent('plan_failed', plan);
        return { success: false, error: errorMessage, partialResults: context.stepResults };
      }
      // Retry the step
      continue;
    }

    // Success - move to next step
    step.status = 'completed';
    step.result = result;
    context.stepResults[step.id] = result;
    logStepEvent('step_completed', plan, step, result);
    currentStepIndex++;
  }

  // All steps completed
  plan.status = 'completed';
  logPlanEvent('plan_completed', plan);
  return {
    success: true,
    results: context.stepResults,
    finalResponse: synthesizeResponse(context.stepResults),
  };
}

function logPlanEvent(event: string, plan: ExecutionPlan) {
  console.log(JSON.stringify({
    event,
    planId: plan.id,
    version: plan.version,
    status: plan.status,
    timestamp: new Date().toISOString(),
  }));
}

function logStepEvent(event: string, plan: ExecutionPlan, step: PlanStep, result?: StepResult) {
  console.log(JSON.stringify({
    event,
    planId: plan.id,
    stepId: step.id,
    agent: step.agent,
    status: step.status,
    retryCount: step.retryCount,
    error: result?.error,
    timestamp: new Date().toISOString(),
  }));
}
```

### Step 1.7: Implement General Agent

**Purpose**: Create a "catch-all" agent that wraps the existing message handler with full tool access. This allows Phase 1 to work end-to-end without requiring specialized agents. It's also the permanent fallback for requests that don't fit other agents.

**Prerequisites**:
- Step 1.5a (execute-with-tools helper)
- Existing `handleMessage` function in `src/llm/`

**Key Design Decisions**:
- Wraps existing handler rather than reimplementing - minimizes Phase 1 scope
- Has access to all tools (`['*']`) - it's the universal fallback
- Returns structured StepResult from the existing handler's output
- Agent description is intentionally broad ("handles all tasks")

**Relevant Requirements**:
- NFR-6 (Extensibility) - general-agent is the extension point for unclassified requests
- FR-4 (Agent Isolation) - even general-agent goes through the orchestrator

**Acceptance Criteria**:
- [ ] Wraps existing handleMessage without changing its behavior
- [ ] Returns structured StepResult with success/output/error
- [ ] Passes through all existing tool capabilities
- [ ] Handles both tool-using and non-tool responses
- [ ] Captures tool calls for observability

**Gotchas**:
- The existing handler might return differently shaped data - normalize to StepResult
- Watch for circular dependencies if handleMessage also uses orchestrator
- Ensure error handling is consistent with other agents (errors in result, not thrown)
- This agent should work identically to the current system for single-step requests

Create `src/agents/general-agent.ts`.

This wraps your existing LLM handler:

```typescript
import { AgentCapability } from '../orchestrator/types';
import { executeWithTools } from './execute-with-tools';
import { handleMessage } from '../llm'; // Your existing handler

export const generalAgent: AgentCapability = {
  name: 'general-agent',
  description: 'Handles all tasks using the full tool suite',
  tools: ['*'],
  examples: ['General requests', 'Multi-domain tasks'],
};

export async function executeGeneralAgent(
  task: string,
  context: AgentContext,
  llmClient: LLMClient
): Promise<StepResult> {
  // Use existing message handler
  const response = await handleMessage({
    content: task,
    userId: context.userId,
    // Pass through existing context
  });

  return {
    success: true,
    output: response.content,
    toolCalls: response.toolCalls,
  };
}
```

### Step 1.8: Integration Point

**Purpose**: Connect the orchestrator to the existing message handling flow. This is where the orchestrator "goes live" and starts processing real user messages. Uses a feature flag approach for safe rollout.

**Prerequisites**:
- All previous Phase 1 steps (orchestrator is complete)
- Existing user config/memory loading functions
- Existing conversation history storage

**Key Design Decisions**:
- Feature flag controls orchestrator usage - easy rollback if issues arise
- Orchestrator receives assembled context, not raw database queries
- Error responses are user-friendly, not technical
- Response is stored in conversation history for future context

**Relevant Requirements**:
- "Message Handler Flow" section of design doc
- "Message Context Assembly" section describing context layers

**Acceptance Criteria**:
- [ ] Feature flag controls whether orchestrator is used
- [ ] User config loaded (name, timezone)
- [ ] User memory loaded (facts)
- [ ] Conversation history loaded with window config
- [ ] Orchestrator receives fully-assembled context
- [ ] Response stored in conversation history
- [ ] Error case returns graceful user message

**Gotchas**:
- Feature flag should be per-user for gradual rollout
- Loading user context should happen in parallel for performance
- Make sure conversation history includes the current message before calling orchestrator
- Consider what happens if memory/history loading fails - should degrade gracefully
- Response storage should happen even on partial success

Update your main message handler to use the orchestrator:

```typescript
// src/llm/index.ts (or wherever your entry point is)

import { orchestrate } from '../orchestrator';

export async function handleIncomingMessage(message: IncomingMessage) {
  const { content, userId } = message;

  // Load user context
  const history = await getConversationHistory(userId);
  const memory = await getUserMemory(userId);

  // Run orchestrator
  const result = await orchestrate(content, history, memory, llmClient);

  if (!result.success) {
    return { content: `I encountered an issue: ${result.error}` };
  }

  return { content: result.finalResponse };
}
```

### Phase 1 Checklist

- [ ] Core types defined
- [ ] Agent registry with general-agent
- [ ] Conversation window filtering
- [ ] Planner creates single-step plans
- [ ] Executor runs steps with timeout
- [ ] Main orchestrator loop working
- [ ] General agent wraps existing handler
- [ ] Integration with message entry point
- [ ] Basic error handling and retries

### Phase 1 Testing

```typescript
// Test: Simple request creates single-step plan
const result = await orchestrate(
  "What's the weather?",
  [],
  { facts: [] },
  mockLLMClient
);
expect(result.success).toBe(true);
expect(Object.keys(result.results).length).toBe(1);

// Test: Timeout handling
const slowClient = createSlowMockClient(70_000); // 70s response
const result = await orchestrate("Test", [], {}, slowClient);
expect(result.success).toBe(false);
expect(result.error).toContain('timeout');
expect(Object.keys(result.partialResults).length).toBeGreaterThanOrEqual(0);

// Test: Retry on failure
const failOnceClient = createFailOnceMockClient();
const result = await orchestrate("Test", [], {}, failOnceClient);
expect(result.success).toBe(true); // Should succeed on retry
```

---

## Phase 2: First Specialized Agents

**Goal**: Extract calendar and scheduler agents to enable multi-step plans.

**Why Calendar + Scheduler First?**: These two agents frequently work together (e.g., "check my calendar and remind me about meetings"), making them ideal for validating multi-step plan execution and step-to-step context passing.

### Step 2.1: Define Calendar Agent

**Purpose**: Create a specialized agent for calendar operations. This agent has focused capabilities and tools, demonstrating the benefit of specialization over the general agent.

**Prerequisites**:
- Phase 1 complete (orchestrator working with general-agent)
- Existing calendar tools in `src/llm/tools/` (list_events, create_event, etc.)

**Key Design Decisions**:
- Limited tool set: only calendar-related tools (not email, reminders, etc.)
- Output schema defines expected structure for step results - helps orchestrator understand what data is available for next steps
- Description helps planner know when to route to this agent vs. general-agent
- Examples guide the LLM in understanding agent scope

**Relevant Requirements**:
- NFR-6 (Extensibility) - adding this agent should only require registry entry + definition
- FR-4 (Agent Isolation) - only calendar tools available
- "Agent Registry" section of design doc

**Acceptance Criteria**:
- [ ] Agent has only calendar-related tools
- [ ] Agent can list events for a date range
- [ ] Agent can create events with details (title, time, attendees)
- [ ] Agent can update existing events
- [ ] Agent can delete events
- [ ] Output follows defined schema (events/created/updated/deleted arrays)
- [ ] Planner correctly routes calendar requests to this agent

**Gotchas**:
- The tool names must match exactly what's in the tool registry
- Output schema is for documentation/validation, not runtime enforcement
- Agent should handle "no events found" gracefully (empty array, not error)
- Time handling should respect user's timezone (passed in context)

Create `src/agents/calendar-agent.ts`:

```typescript
import { AgentCapability } from '../orchestrator/types';
import { executeWithTools } from './execute-with-tools';

export const calendarAgent: AgentCapability = {
  name: 'calendar-agent',
  description: 'Manages calendar events: view, create, update, delete events',
  tools: [
    'get_calendar_events',
    'create_calendar_event',
    'update_calendar_event',
    'delete_calendar_event',
  ],
  examples: [
    'Check my schedule for tomorrow',
    'Create a meeting at 3pm',
    'Move my dentist appointment to Friday',
  ],
  outputSchema: {
    type: 'object',
    properties: {
      events: { type: 'array' },
      created: { type: 'array' },
      updated: { type: 'array' },
      deleted: { type: 'array' },
    },
  },
};

export async function executeCalendarAgent(
  task: string,
  context: AgentContext,
  llmClient: LLMClient
): Promise<StepResult> {
  const systemPrompt = `You are a calendar management agent.
You have access to these tools: ${calendarAgent.tools.join(', ')}

Complete the following task concisely.`;

  return await executeWithTools(systemPrompt, task, calendarAgent.tools, llmClient);
}
```

### Step 2.2: Define Scheduler Agent

**Purpose**: Create a specialized agent for reminder/scheduled job operations. Frequently works in conjunction with calendar-agent (e.g., "remind me about my 3pm meeting").

**Prerequisites**:
- Phase 1 complete
- Existing scheduler tools in `src/llm/tools/` (create_scheduled_job, etc.)
- Step 2.1 (calendar-agent) - for testing multi-step flows

**Key Design Decisions**:
- Separate from calendar because reminders are a distinct domain (stored differently, triggered by scheduler)
- Tools focus on CRUD for scheduled jobs, not calendar events
- Often receives data from previous steps (e.g., events to create reminders for)
- Output includes created/updated/deleted arrays for clear feedback

**Relevant Requirements**:
- FR-5 (Context Passing) - this agent frequently uses output from calendar-agent
- NFR-6 (Extensibility)
- "Context Flow Example" in design doc shows email→scheduler flow

**Acceptance Criteria**:
- [ ] Agent has only scheduler-related tools
- [ ] Can create reminders with time and message
- [ ] Can update existing reminders
- [ ] Can delete/cancel reminders
- [ ] Can list active reminders
- [ ] Uses previous step output when creating reminders based on events
- [ ] Handles recurring reminders (daily/weekly patterns)

**Gotchas**:
- Reminder times need to respect user's timezone
- When creating reminders from events, extract relevant info (title, time) from previous step
- Handle edge cases: reminder time in the past, duplicate reminders
- Consider timezone differences between event time and reminder time

Create `src/agents/scheduler-agent.ts`:

```typescript
import { AgentCapability } from '../orchestrator/types';

export const schedulerAgent: AgentCapability = {
  name: 'scheduler-agent',
  description: 'Manages scheduled jobs and reminders',
  tools: [
    'create_scheduled_job',
    'update_scheduled_job',
    'delete_scheduled_job',
    'get_scheduled_jobs',
  ],
  examples: [
    'Remind me to call mom at 5pm',
    'Set a daily standup reminder',
    'Cancel my morning alarm',
  ],
  outputSchema: {
    type: 'object',
    properties: {
      jobs: { type: 'array' },
      created: { type: 'array' },
      updated: { type: 'array' },
      deleted: { type: 'array' },
    },
  },
};

export async function executeSchedulerAgent(
  task: string,
  context: AgentContext,
  llmClient: LLMClient
): Promise<StepResult> {
  const systemPrompt = `You are a scheduling agent.
You have access to these tools: ${schedulerAgent.tools.join(', ')}

Complete the following task concisely.`;

  return await executeWithTools(systemPrompt, task, schedulerAgent.tools, llmClient);
}
```

### Step 2.3: Update Agent Registry

**Purpose**: Add the new specialized agents to the registry so the planner can discover and route to them.

**Prerequisites**:
- Steps 2.1 and 2.2 complete (agent definitions exist)
- Step 1.2 (registry exists)

**Key Design Decisions**:
- Specialized agents are listed before general-agent to encourage specific routing
- Agent descriptions must be distinct enough for planner to differentiate
- All agents share the same registry interface

**Relevant Requirements**:
- NFR-6 (Extensibility) - "only require adding an entry to the registry"

**Acceptance Criteria**:
- [ ] Calendar-agent in registry and discoverable
- [ ] Scheduler-agent in registry and discoverable
- [ ] `listAgents()` returns all three agents with descriptions
- [ ] Planner receives updated agent descriptions
- [ ] No breaking changes to existing registry interface

**Gotchas**:
- Order matters for some LLMs - consider listing specialized agents first
- Make sure agent names are unique (no duplicates)
- Verify descriptions don't overlap confusingly

```typescript
// src/orchestrator/agent-registry.ts

import { generalAgent } from '../agents/general-agent';
import { calendarAgent } from '../agents/calendar-agent';
import { schedulerAgent } from '../agents/scheduler-agent';

const agents: AgentCapability[] = [
  calendarAgent,     // Specialized agents first
  schedulerAgent,
  generalAgent,      // Fallback last
];
```

### Step 2.4: Create Agent Executor Router

**Purpose**: Create a routing layer that dispatches step execution to the appropriate agent executor. This decouples the orchestrator from specific agent implementations.

**Prerequisites**:
- Steps 2.1-2.3 complete
- Step 1.5 (executor calls this router)

**Key Design Decisions**:
- Simple map-based routing: agent name → executor function
- Unknown agents fall back to general-agent (graceful degradation)
- Each executor has the same signature for consistency
- Router doesn't contain business logic - just dispatches

**Relevant Requirements**:
- NFR-6 (Extensibility) - adding agent executor is straightforward
- FR-4 (Agent Isolation) - router ensures each agent gets its own executor

**Acceptance Criteria**:
- [ ] Routes to calendar-agent executor for "calendar-agent"
- [ ] Routes to scheduler-agent executor for "scheduler-agent"
- [ ] Falls back to general-agent for unknown agent names
- [ ] All executors return consistent StepResult format
- [ ] Adding a new agent requires only adding to the executors map

**Gotchas**:
- Make sure the fallback to general-agent is logged (helps debugging)
- Consider if you want strict mode (throw on unknown) vs. lenient mode (fallback)
- Keep the router simple - complex logic belongs in agents, not here

```typescript
// src/orchestrator/agent-executor.ts

import { executeGeneralAgent } from '../agents/general-agent';
import { executeCalendarAgent } from '../agents/calendar-agent';
import { executeSchedulerAgent } from '../agents/scheduler-agent';

const executors: Record<string, AgentExecutor> = {
  'general-agent': executeGeneralAgent,
  'calendar-agent': executeCalendarAgent,
  'scheduler-agent': executeSchedulerAgent,
};

export async function executeAgent(
  agentName: string,
  task: string,
  context: AgentContext,
  llmClient: LLMClient
): Promise<StepResult> {
  const executor = executors[agentName];
  if (!executor) {
    // Fallback to general agent
    return executeGeneralAgent(task, context, llmClient);
  }
  return executor(task, context, llmClient);
}
```

### Phase 2 Testing

```typescript
// Test: Multi-step plan with different agents
const result = await orchestrate(
  "Check my calendar for tomorrow and remind me about any meetings at 8am",
  [],
  { facts: [] },
  llmClient
);

// Should create 2-step plan:
// 1. calendar-agent: Check calendar for tomorrow
// 2. scheduler-agent: Create reminders for meetings
expect(result.success).toBe(true);
```

### Phase 2 Checklist

- [ ] Calendar agent defined with tools
- [ ] Scheduler agent defined with tools
- [ ] Agent registry updated
- [ ] Agent executor router working
- [ ] Multi-step plans generated correctly
- [ ] Step results passed between agents

---

## Phase 3: Remaining Agents

**Goal**: Complete agent coverage for full functionality.

**Why These Agents**: Email, memory, and UI agents complete the core feature set. Email enables workflows like "check email and remind me about deadlines". Memory agent handles explicit "remember this" requests. UI agent enables rich interactive responses.

### Step 3.1: Email Agent

**Purpose**: Create a specialized agent for email read/send operations. Enables workflows like "check my email and summarize urgent items" or "email John about tomorrow's meeting".

**Prerequisites**:
- Phase 2 complete (multi-step flows working)
- Email tools exist in codebase (get_emails, send_email, etc.)
- Gmail/email API integration configured

**Key Design Decisions**:
- Read-focused initially (search, list, read content)
- Send capability with safety considerations (confirm before sending?)
- Output includes extracted data (action items, deadlines) for downstream steps
- Search supports filters (from, subject, date range, labels)

**Relevant Requirements**:
- FR-5 (Context Passing) - email content passed to scheduler for reminder creation
- "Example 3: Multi-Step Request" in design doc shows email→scheduler flow

**Acceptance Criteria**:
- [ ] Can search emails by various criteria
- [ ] Can read full email content
- [ ] Can send emails (with appropriate safeguards)
- [ ] Extracts structured data (action items, deadlines) for downstream use
- [ ] Handles "no emails found" gracefully
- [ ] Respects email API rate limits

**Gotchas**:
- Email content can be very long - consider summarization or truncation
- Handle HTML vs. plain text email bodies
- Be careful with PII in email content (don't log full bodies)
- Consider confirmation flow for sending emails (destructive action)
- Handle email threading/conversations appropriately

```typescript
// src/agents/email-agent.ts

import { AgentCapability } from '../orchestrator/types';
import { executeWithTools } from './execute-with-tools';

export const emailAgent: AgentCapability = {
  name: 'email-agent',
  description: 'Reads and sends emails',
  tools: [
    'get_emails',
    'send_email',
    'search_emails',
  ],
  examples: [
    'Check my unread emails',
    'Send an email to John about the meeting',
    'Find emails from last week about the project',
  ],
  outputSchema: {
    type: 'object',
    properties: {
      emails: { type: 'array' },
      sent: { type: 'array' },
    },
  },
};

export async function executeEmailAgent(
  task: string,
  context: AgentContext,
  llmClient: LLMClient
): Promise<StepResult> {
  const systemPrompt = `You are an email agent.
You have access to these tools: ${emailAgent.tools.join(', ')}

Complete the following task concisely.`;

  return await executeWithTools(systemPrompt, task, emailAgent.tools, llmClient);
}
```

### Step 3.2: Memory Agent

**Purpose**: Create a specialized agent for memory write operations and complex memory searches. While the orchestrator has read access to memory (in its system prompt), write operations require reasoning about what to store and how.

**Prerequisites**:
- Phase 2 complete
- Memory/facts storage exists (`src/memory/` or similar)
- Understanding of "Memory: Read vs. Write" section in design doc

**Key Design Decisions**:
- Orchestrator READS memory (already in context) - this agent WRITES memory
- Handles "remember that..." requests
- Performs semantic search for "what do you know about..." queries
- Manages deduplication and categorization of facts
- Can update or remove outdated information

**Relevant Requirements**:
- UT-3 (Memory Read) - orchestrator has this, not memory-agent
- UT-4 (Memory Write Delegation) - this is what memory-agent does
- FR-7 (Memory Isolation) - orchestrator sees full memory, sub-agents don't
- "Memory: Read vs. Write" section of design doc

**Acceptance Criteria**:
- [ ] Can store new facts/preferences
- [ ] Categorizes facts appropriately (work, personal, preferences)
- [ ] Deduplicates similar facts (updates rather than duplicates)
- [ ] Can search memory semantically
- [ ] Can update existing facts
- [ ] Can remove outdated facts
- [ ] Returns structured output (stored/updated/removed facts)

**Gotchas**:
- This agent doesn't have access to full memory in its prompt - only what's passed in task
- Be careful with fact categorization - affects retrieval
- Deduplication needs semantic similarity, not just string matching
- Consider fact expiration/staleness (preferences change over time)
- Handle contradictory facts (new info should update old)

```typescript
// src/agents/memory-agent.ts

import { AgentCapability } from '../orchestrator/types';
import { executeWithTools } from './execute-with-tools';

export const memoryAgent: AgentCapability = {
  name: 'memory-agent',
  description: 'Manages user preferences, facts, and long-term memory',
  tools: [
    'remember_fact',
    'get_user_facts',
    'update_user_preference',
  ],
  examples: [
    'Remember that I prefer morning meetings',
    'What do you know about my work schedule?',
    'Update my timezone preference',
  ],
  outputSchema: {
    type: 'object',
    properties: {
      facts: { type: 'array' },
      updated: { type: 'array' },
    },
  },
};

export async function executeMemoryAgent(
  task: string,
  context: AgentContext,
  llmClient: LLMClient
): Promise<StepResult> {
  const systemPrompt = `You are a memory agent.
You have access to these tools: ${memoryAgent.tools.join(', ')}

Complete the following task concisely.`;

  return await executeWithTools(systemPrompt, task, memoryAgent.tools, llmClient);
}
```

### Step 3.3: UI Agent

**Purpose**: Create an agent that generates interactive web pages for rich data display. Enables "show me my reminders in a page I can edit" type requests that go beyond SMS text limitations.

**Prerequisites**:
- Phase 2 complete
- Page rendering infrastructure (storage, URL generation, serving)
- Understanding of how pages are served to users (link in SMS?)

**Key Design Decisions**:
- Generates standalone HTML/CSS/JS (no framework dependencies)
- Pages are static but can have client-side interactivity
- Returns a URL that can be sent to the user
- Uses data from previous steps (events, reminders) to populate the page
- Lightweight - no server-side rendering complexity

**Relevant Requirements**:
- "Example 4: Replan Scenario" shows ui-agent handling empty state gracefully
- FR-5 (Context Passing) - ui-agent uses data from previous steps

**Acceptance Criteria**:
- [ ] Generates valid, styled HTML pages
- [ ] Can display lists (events, reminders, emails)
- [ ] Can create editable interfaces (checkboxes, forms)
- [ ] Handles empty state gracefully (friendly message, not blank page)
- [ ] Returns URL to generated page
- [ ] Pages work on mobile (SMS users often on phones)
- [ ] Includes preview text for SMS response

**Gotchas**:
- Generated pages need to be stored somewhere accessible
- Consider page expiration (don't keep pages forever)
- Mobile-first design (primary users are on phones)
- Keep JS minimal - complex interactions are fragile
- Handle case where previous step returned empty data (no events to display)
- Consider accessibility (screen readers, high contrast)
- Security: don't include sensitive data in URLs, sanitize user content

```typescript
// src/agents/ui-agent.ts

import { AgentCapability } from '../orchestrator/types';
import { executeWithTools } from './execute-with-tools';

export const uiAgent: AgentCapability = {
  name: 'ui-agent',
  description: 'Renders UI components and interactive elements',
  tools: [
    'render_page',
  ],
  examples: [
    'Show my tasks as a checklist',
    'Display the calendar as a week view',
  ],
  outputSchema: {
    type: 'object',
    properties: {
      html: { type: 'string' },
      css: { type: 'string' },
      js: { type: 'string' },
      previewText: { type: 'string' },
    },
  },
};

export async function executeUiAgent(
  task: string,
  context: AgentContext,
  llmClient: LLMClient
): Promise<StepResult> {
  const systemPrompt = `You are a UI rendering agent.
You can generate a single static page with lightweight interactivity.
Return HTML/CSS/JS suitable for a standalone page.
You have access to these tools: ${uiAgent.tools.join(', ')}

Complete the following task concisely.`;

  return await executeWithTools(systemPrompt, task, uiAgent.tools, llmClient);
}
```

### Phase 3 Checklist

- [ ] Email agent implemented with read/send capabilities
- [ ] Memory agent implemented with write/search capabilities
- [ ] UI agent implemented with page generation
- [ ] All agents registered in agent-executor.ts
- [ ] Complex multi-agent flows working (3+ step plans)
- [ ] Cross-agent data passing validated (email→scheduler, calendar→ui)

---

## Cross-Cutting Concerns

These apply throughout all phases and should be considered at each step:

### Error Handling
- All errors should be captured in `StepResult.error`, not thrown
- User-facing error messages should be friendly, not technical
- Log technical details for debugging, show simple messages to users
- Partial success is preferred over complete failure (FR-3)

### Observability (NFR-2)
- All plan/step state transitions logged as structured JSON
- Include: timestamp, planId, stepId, agent, status, error (if any)
- Token usage tracked per step for budget monitoring
- Consider correlation IDs for tracing across steps

### Timeouts
- Plan-level: 2 minutes max (C-1)
- Step-level: 60 seconds max (C-5)
- Timeout errors should be distinguishable from other errors
- On timeout, return partial results (NFR-5)

### User Context
- All agents receive user config (name, timezone) via FR-9
- Times should be in user's timezone, not UTC
- Personalization (using user's name) is encouraged

### Security
- Don't log full email/message content (PII)
- Sanitize user content before including in generated pages
- Consider confirmation for destructive actions (send email, delete event)

---

## Testing Strategy

Testing is critical for the orchestrator since it coordinates multiple components. Each phase should have comprehensive tests before moving to the next.

### Unit Tests

Each component should have unit tests with mocked dependencies:

```
src/orchestrator/__tests__/
├── planner.test.ts           # Plan creation, date resolution
├── replanner.test.ts         # Replan logic, step merging
├── executor.test.ts          # Step execution, timeout handling
├── conversation-window.test.ts # History filtering, token limits
└── agent-registry.test.ts    # Agent lookup, listing

src/agents/__tests__/
├── general-agent.test.ts     # Wraps existing handler correctly
├── calendar-agent.test.ts    # Calendar operations
├── scheduler-agent.test.ts   # Reminder operations
├── email-agent.test.ts       # Email operations
├── memory-agent.test.ts      # Memory write operations
└── ui-agent.test.ts          # Page generation
```

**Unit Test Focus Areas**:
- **Planner**: JSON parsing, date resolution, agent selection
- **Executor**: Timeout behavior, error formatting, context passing
- **Conversation Window**: Age filtering, count limits, token estimation
- **Agents**: Tool invocation, output formatting, error handling

### Integration Tests

Test full orchestration flows with real LLM calls (or realistic mocks):

```typescript
describe('Orchestrator Integration', () => {
  it('handles simple single-step requests', async () => {
    const result = await orchestrate("What time is it?", [], {}, client);
    expect(result.success).toBe(true);
  });

  it('handles multi-step calendar + reminder flow', async () => {
const result = await orchestrate(
  "Check tomorrow's meetings and remind me 30 min before each",
  [],
  {},
  client
);
expect(result.success).toBe(true);
expect(Object.keys(result.results).length).toBe(2);
  });

  it('handles failures gracefully', async () => {
    const result = await orchestrate(
      "Send email to invalid-address",
      [],
      {},
      client
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('respects timeout limits', async () => {
    // Test with slow operations
  });
});
```

### Manual Testing Scenarios

| Scenario | Expected Behavior | Key Validations |
|----------|-------------------|-----------------|
| "Hi, how are you?" | No steps, direct response | Doesn't invoke orchestrator |
| "What's on my calendar tomorrow?" | Single-step → calendar-agent | Date resolved correctly |
| "Remind me about my 3pm meeting" | Two-step → calendar-agent → scheduler-agent | Step 2 uses step 1 output |
| "Email John about tomorrow's meeting" | Two-step → calendar-agent → email-agent | Date embedded in tasks |
| "Remember I don't like early meetings" | Single-step → memory-agent | Fact stored correctly |
| "Check my email and remind me about deadlines" | Two-step → email-agent → scheduler-agent | Context flows between steps |
| "Show my reminders in an editable page" | Two-step → scheduler-agent → ui-agent | Handles empty state |
| Request that causes step failure | Retry then replan | Partial results returned |
| Very long request (>2 min) | Timeout with partial results | Timeout message shown |

**Edge Cases to Test**:
- Multiple date references: "Schedule meeting for Friday and remind me Thursday"
- Ambiguous dates: "next Friday" (this week or next?)
- Empty results: "Check calendar" when no events exist
- API failures: Email service down, calendar unavailable
- Rate limits: Multiple rapid requests

---

## Migration Plan

### Before Migration

1. Ensure all existing tests pass
2. Document current message flow
3. Create feature flag for orchestrator

### During Migration

```typescript
// Feature flag approach
export async function handleMessage(message: Message) {
  if (useOrchestrator(message.userId)) {
    return orchestrate(message.content, ...);
  }
  return legacyHandler(message);
}
```

### Rollout Stages

1. **Internal testing**: Enable for test users only
2. **Gradual rollout**: 10% → 25% → 50% → 100%
3. **Monitoring**: Track success rates, latency, errors
4. **Rollback plan**: Disable flag if issues arise

---

## File Structure

After implementation, the structure should look like:

```
src/
├── orchestrator/
│   ├── index.ts              # Main orchestrate() function
│   ├── types.ts              # Type definitions
│   ├── planner.ts            # Plan creation
│   ├── executor.ts           # Step execution
│   ├── conversation-window.ts # History filtering
│   ├── agent-registry.ts     # Agent registration
│   └── __tests__/
│       └── ...
├── agents/
│   ├── general-agent.ts
│   ├── calendar-agent.ts
│   ├── scheduler-agent.ts
│   ├── email-agent.ts
│   ├── memory-agent.ts
│   ├── ui-agent.ts
│   └── __tests__/
│       └── ...
└── llm/
    └── index.ts              # Updated entry point
```

---

## Success Criteria

### Phase 1 Complete When:
- [ ] Orchestrator processes simple requests end-to-end
- [ ] General agent handles all existing functionality
- [ ] Timeout and retry logic working
- [ ] No regression in existing features

### Phase 2 Complete When:
- [ ] Calendar agent extracts and works independently
- [ ] Scheduler agent extracts and works independently
- [ ] Multi-step plans execute correctly
- [ ] Results pass between steps

### Phase 3 Complete When:
- [ ] All agents implemented and registered
- [ ] Complex multi-agent scenarios work
- [ ] Performance within acceptable limits (< 2 min total)
- [ ] Error handling covers edge cases

---

## Notes

- Start simple: Phase 1 with general-agent lets you validate the orchestrator before adding complexity
- Test incrementally: Each phase should be fully tested before moving to the next
- Monitor closely: Track latency and error rates during rollout
- Keep fallbacks: The general-agent can always handle requests if specialized agents fail
