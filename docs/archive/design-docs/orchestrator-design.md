# Orchestrator Agent Design

This document describes the design for an orchestrator agent that plans, delegates, tracks, and dynamically adjusts execution of complex user requests.

> **Related Document:** See [agent-design.md](08-agent-architecture.md) for:
> - Current architecture limitations and motivation for multi-agent design
> - Agent definitions (prompts, tools, token budgets)
> - Implementation phases and timeline
>
> This document focuses on **how the orchestrator coordinates agents**, not the agents themselves.

## Table of Contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Plan Model](#plan-model)
4. [Orchestrator Flow](#orchestrator-flow)
5. [Context Management](#context-management)
6. [Message Context Assembly](#message-context-assembly)
7. [Dynamic Replanning](#dynamic-replanning)
8. [Orchestrator Utility Tools](#orchestrator-utility-tools)
9. [Agent Registry](#agent-registry)
10. [Implementation](#implementation)
11. [Examples](#examples)

---

## Overview

The orchestrator is responsible for:

1. **Planning** - Analyze user request and create an execution plan
2. **Delegation** - Route tasks to specialized agents
3. **Tracking** - Monitor step progress and collect results
4. **Replanning** - Adjust the plan when steps fail or new information emerges

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User Request                                    │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR AGENT                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  1. PLAN PHASE                                                        │  │
│  │     - Analyze intent                                                  │  │
│  │     - Identify required agents                                        │  │
│  │     - Create ordered list of steps                                    │  │
│  │     - Estimate outputs needed                                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                  │                                           │
│                                  ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  2. EXECUTE PHASE (loop)                                              │  │
│  │     - Execute steps sequentially                                      │  │
│  │     - Pass previous results to next step                              │  │
│  │     - Collect result                                                  │  │
│  │     - Check: replan needed?                                           │  │
│  │       - If yes → back to PLAN PHASE with new context                  │  │
│  │       - If no  → continue to next step                                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                  │                                           │
│                                  ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  3. COMPOSE PHASE                                                     │  │
│  │     - Aggregate results from all steps                                │  │
│  │     - Generate user-friendly response                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Requirements

### Functional Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| **FR-1** | Sequential Execution | Steps MUST execute in order, one at a time |
| **FR-2** | Dynamic Replanning | Orchestrator MUST be able to revise the plan when steps fail or return unexpected results |
| **FR-3** | Partial Success | Plan MUST return results from successful steps even if some steps fail |
| **FR-4** | Agent Isolation | Agents MUST NOT communicate directly; all data passes through the orchestrator |
| **FR-5** | Context Passing | Results from previous steps MUST be available to subsequent steps |
| **FR-6** | Retry Support | Failed steps SHOULD be retried (configurable, default 2 retries) before marking as failed |
| **FR-7** | Memory Isolation | Only orchestrator sees full user memory; sub-agents receive task-specific context only |
| **FR-8** | Task-Only Context | Sub-agents MUST NOT see conversation history; they only receive their task + previous step outputs |
| **FR-9** | User Config Propagation | All agents MUST receive user config (name, timezone) for personalization |
| **FR-10** | Modular Prompts | System prompts MUST be composable: base + memory + user context + agent descriptions |

### Utility Tool Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| **UT-1** | Date Resolution | Orchestrator MUST resolve relative dates before creating plan |
| **UT-2** | Consistency | Resolved values MUST be embedded in task descriptions for sub-agents |
| **UT-3** | Memory Read | Orchestrator MUST have user memory available in system prompt |
| **UT-4** | Memory Write Delegation | Memory write operations MUST be delegated to memory-agent |
| **UT-5** | Timezone Awareness | All utility tools MUST respect user's configured timezone |
| **UT-6** | Tool Failure Handling | If utility tool fails, orchestrator SHOULD fall back to natural language description |

### Non-Functional Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| **NFR-1** | Execution Timeout | Plans MUST fail if total execution exceeds 60 seconds |
| **NFR-2** | Observability | All plan/step state transitions MUST be logged with structured JSON |
| **NFR-3** | Traceability | Each plan and step MUST have unique IDs for debugging and correlation |
| **NFR-4** | Best-Effort Determinism | Given identical input, planning SHOULD produce similar plans (temperature=0) |
| **NFR-5** | Graceful Degradation | On timeout or failure, orchestrator MUST return partial results with error context |
| **NFR-6** | Extensibility | Adding a new agent MUST only require adding an entry to the agent registry |

### Constraints

| ID | Constraint | Value |
|----|------------|-------|
| **C-1** | Max plan execution time | 5 minutes |
| **C-2** | Max replans per request | 3 |
| **C-3** | Max total steps | 10 |
| **C-4** | Max retries per step | 2 (configurable) |
| **C-5** | Step timeout | 2 minutes per step |

### Acceptance Criteria

```gherkin
Feature: Orchestrator sequential execution
  Scenario: Steps execute in order
    Given a plan with steps A, B, C
    When the plan executes
    Then step B should start only after A completes
    And step C should start only after B completes

Feature: Orchestrator partial success
  Scenario: A step fails mid-plan
    Given a plan with steps A, B, C where B fails
    When the plan executes
    Then results from A should be returned
    And the response should explain B failed and C was skipped

Feature: Orchestrator timeout
  Scenario: Plan exceeds timeout
    Given a plan that would take 3 minutes
    When 2 minutes elapse
    Then execution should stop
    And partial results should be returned
    And error should indicate timeout

Feature: Orchestrator replanning
  Scenario: Step returns empty results
    Given step_1 returns empty data
    And step_2 needs step_1's output
    When step_1 completes
    Then orchestrator should replan
    And revised plan should handle the empty case
```

---

## Plan Model

### Core Types

```typescript
// src/agents/types.ts

/**
 * Status of a plan step
 */
type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * A single step in the execution plan
 */
interface PlanStep {
  id: string;                      // Unique identifier (e.g., "step_1")
  agent: string;                   // Which agent handles this (e.g., "email-agent")
  task: string;                    // Natural language description of what to do
  status: StepStatus;
  result?: StepResult;             // Populated after execution
  retryCount: number;              // Number of retry attempts
  maxRetries: number;              // Max retries before failing (default: 2)
}

/**
 * Result from executing a step
 */
interface StepResult {
  success: boolean;
  output: unknown;                 // Structured output from the agent
  error?: string;                  // Error message if failed
  tokenUsage?: {
    input: number;
    output: number;
  };
}

/**
 * The complete execution plan
 */
interface ExecutionPlan {
  id: string;                      // Plan ID for tracking
  userRequest: string;             // Original user message
  steps: PlanStep[];               // Ordered list of steps
  status: 'planning' | 'executing' | 'replanning' | 'completed' | 'failed';
  context: PlanContext;            // Accumulated context from steps
  version: number;                 // Incremented on each replan
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Context accumulated during plan execution
 * This is passed to subsequent steps and used for replanning
 */
interface PlanContext {
  // Results from completed steps, keyed by step ID
  stepResults: Record<string, StepResult>;

  // Errors encountered (for replanning decisions)
  errors: Array<{ stepId: string; error: string }>;
}
```

### Plan Step States

```
┌─────────┐    ┌─────────┐    ┌─────────────┐
│ pending │───▶│ running │───▶│  completed  │
└─────────┘    └─────────┘    └─────────────┘
                    │
                    │ (on failure)
                    ▼
               ┌─────────┐
               │  failed │──────▶ (retry or replan)
               └─────────┘

Transitions:
- pending → running:   Orchestrator picks up the next step
- running → completed: Agent returns success
- running → failed:    Agent returns error (may retry or replan)
```

---

## Orchestrator Flow

### Phase 1: Planning (with Utility Tools)

The orchestrator makes an LLM call with utility tools enabled. It resolves dates/times FIRST, then creates the plan with resolved values.

```typescript
// Orchestrator's planning prompt
const PLANNING_PROMPT = `You are a task planning assistant. Analyze the user's request and create an execution plan.

<utility_tools>
You have access to utility tools for planning:
- **resolve_date**: Convert relative dates ("friday", "next tuesday") to ISO dates
- **resolve_time_range**: Convert time ranges ("this week", "next month") to start/end timestamps
- **get_current_time**: Get current time in user's timezone

IMPORTANT: If the user's request contains relative dates or times:
1. FIRST call the appropriate utility tool to resolve them
2. THEN create the plan with resolved dates embedded in task descriptions
3. This ensures all sub-agents use the SAME date

Example:
  User: "What's on my calendar friday?"
  1. Call resolve_date("friday") → "2026-01-30"
  2. Create plan with: "List events on 2026-01-30 (Friday)"
</utility_tools>

<available_agents>
{{AGENT_DESCRIPTIONS}}
</available_agents>

<user_memory>
{{USER_MEMORY}}
</user_memory>

Use relevant facts from memory to inform task descriptions.
Example: If memory says "prefers morning reminders at 8am", include that in reminder tasks.

<plan_output>
After resolving any dates, create a plan as JSON:
\`\`\`json
{
  "analysis": "Brief analysis of what the user wants",
  "resolvedValues": {
    "dates": { "friday": "2026-01-30" },
    "timeRanges": {}
  },
  "steps": [
    {
      "id": "step_1",
      "agent": "agent-name",
      "task": "Clear description with RESOLVED dates included"
    },
    {
      "id": "step_2",
      "agent": "another-agent",
      "task": "Description that can reference step_1 results"
    }
  ],
  "responseHint": "How to present results to the user"
}
\`\`\`
</plan_output>

<rules>
1. ALWAYS resolve relative dates before creating the plan
2. Embed resolved dates in task descriptions (not relative terms)
3. Use the minimum number of steps needed
4. Order steps logically - later steps can use results from earlier steps
5. Each step should be self-contained with clear success criteria
6. If the request is simple (greeting, question), use zero steps and respond directly
7. Incorporate relevant user preferences from memory into task descriptions
</rules>
`;
```

### Phase 2: Sequential Execution

The executor processes steps in order, one at a time:

```
executePlan(plan):
  1. For each step in order:
     a. Check plan-level timeout (C-1: 5 min limit)
     b. Execute step with previous results as context
     c. Store result in context.stepResults
     d. If failed:
        - Retry up to maxRetries times (C-4)
        - If still failed: check if replan needed
        - If replan not possible: stop execution
     e. Check for replan signals in result
     f. If replan needed and allowed → replan() and restart
  2. Return plan with final status
```

**Key behaviors:**
- Steps execute sequentially in plan order (FR-1)
- Each step receives results from all previous steps as context
- Failed steps are retried up to `maxRetries` times (FR-6, C-4)
- If a step fails, remaining steps are not executed
- Plan can still return partial results from completed steps (FR-3)

### Phase 3: Response Composition

After all steps complete, compose the final response:

```
composeResponse(plan):
  1. Collect all step results (successes and failures)
  2. LLM call to generate user-friendly message
  3. Include any generated URLs (UI pages, etc.)
  4. Explain partial failures if any
```

The composition prompt instructs the LLM to:
- Keep responses conversational and SMS-appropriate
- Not mention internal steps or technical details
- Acknowledge what succeeded and what failed

---

## Context Management

### Overview

Context flows through the system in a controlled manner:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONTEXT SOURCES                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ System Prompt│  │ User Memory  │  │ User Config  │  │ Conv History │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                 │                 │                 │              │
│         └────────────────┼─────────────────┼─────────────────┘              │
│                          │                 │                                 │
│                          ▼                 │                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      ORCHESTRATOR CONTEXT                              │  │
│  │  - Full system prompt (modular)                                       │  │
│  │  - Complete user memory                                               │  │
│  │  - User config (name, timezone)                                       │  │
│  │  - Conversation history                                               │  │
│  │  - Agent descriptions (for planning)                                  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                          │                                                   │
│                          │ (filtered)                                        │
│                          ▼                                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        SUB-AGENT CONTEXT                               │  │
│  │  - Agent-specific system prompt                                       │  │
│  │  - Task description (from plan step)                                  │  │
│  │  - Previous step outputs (from completed steps)                       │  │
│  │  - User config (name, timezone) ✓                                     │  │
│  │  - User memory ✗ (orchestrator only)                                  │  │
│  │  - Conversation history ✗ (task only)                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Context Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| **CTX-1** | Memory Isolation | Sub-agents MUST NOT receive full user memory; orchestrator filters relevant context into task |
| **CTX-2** | Task-Only History | Sub-agents MUST NOT see conversation history; they only see their task + previous step outputs |
| **CTX-3** | User Config Access | All agents MUST receive user config (name, timezone) for personalization |
| **CTX-4** | Modular System Prompt | Orchestrator system prompt MUST be composable: base + memory + agent descriptions |
| **CTX-5** | Previous Step Context | Sub-agents MUST receive outputs from previous steps as context |
| **CTX-6** | Context Size Limits | Each agent's total context MUST fit within model limits (track token usage) |

### Orchestrator System Prompt Structure

The orchestrator uses a modular, composable system prompt:

```typescript
interface OrchestratorPromptConfig {
  basePrompt: string;           // Core orchestrator instructions
  memorySection: string;        // User's memory (facts, preferences)
  userContext: string;          // User config (name, timezone)
  agentDescriptions: string;    // Available agents for planning
  utilityToolsDesc: string;     // Utility tools for date resolution, etc.
  timeContext: string;          // Current date/time
}

function buildOrchestratorPrompt(config: OrchestratorPromptConfig): string {
  return `<current_time>${config.timeContext}</current_time>

${config.basePrompt}

<user_context>
${config.userContext}
</user_context>

<user_memory>
${config.memorySection}
</user_memory>

<available_agents>
${config.agentDescriptions}
</available_agents>
`;
}
```

**Example composed prompt:**

```
<current_time>Wednesday, January 28, 2026 at 10:30 AM PST</current_time>

You are an orchestrator that plans and coordinates tasks for a personal assistant.
Your job is to:
1. Analyze the user's request
2. Create an execution plan using available agents
3. Ensure dependencies are correctly specified
...

<user_context>
  <name>Alex</name>
  <timezone>America/Los_Angeles</timezone>
</user_context>

<user_memory>
  <fact category="preferences">Prefers morning meetings before 10am</fact>
  <fact category="work">Works at Acme Corp as a software engineer</fact>
  <fact category="personal">Has a dog named Max</fact>
</user_memory>

<available_agents>
  <agent name="email-agent">
    Reads and analyzes emails from Gmail.
    Capabilities: Search emails, read full content, extract action items
  </agent>
  <agent name="calendar-agent">
    Manages Google Calendar events.
    Capabilities: Create, list, update, delete events
  </agent>
  <agent name="scheduler-agent">
    Creates and manages reminders.
    Capabilities: Create, list, update, delete scheduled jobs
  </agent>
  ...
</available_agents>
```

### Sub-Agent Context Structure

Sub-agents receive minimal, focused context:

```typescript
interface SubAgentContext {
  systemPrompt: string;         // Agent-specific instructions
  userConfig: UserConfig;       // Name, timezone (always included)
  task: string;                 // The task from the plan step
  previousStepOutputs: Record<string, unknown>;  // Results from earlier steps
}
```

The orchestrator builds sub-agent context by:
1. Starting with the agent's specialized system prompt
2. Appending user config (name, timezone)
3. Appending previous step outputs as structured context

**Example sub-agent task (scheduler-agent):**

```
Create reminders for each urgent action item found in the emails.
Use appropriate times based on deadlines.

<context_from_previous_steps>
  <step id="step_1">
    {
      "summary": "Found 2 urgent emails",
      "actionItems": [
        {
          "description": "Complete Q1 report",
          "deadline": "2026-01-31",
          "priority": "high"
        },
        {
          "description": "Send proposal to client",
          "deadline": "2026-01-29",
          "priority": "medium"
        }
      ]
    }
  </step>
</context_from_previous_steps>
```

### Context Flow Example

```
User: "Check my email and remind me about anything urgent"

┌─────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR receives:                                          │
│  - System prompt (with agent descriptions)                      │
│  - User memory: "Prefers morning reminders at 8am"              │
│  - User config: { name: "Alex", timezone: "America/Los_Angeles" }│
│  - Conversation history: [previous messages...]                 │
│  - Current message: "Check my email and remind me..."           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Creates plan, noting from memory:
                              │ "User prefers 8am reminders"
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: email-agent receives:                                   │
│  - Agent system prompt (email specialist)                       │
│  - User config: { name: "Alex", timezone: "America/Los_Angeles" }│
│  - Task: "Search for urgent emails, extract action items"       │
│  - NO memory, NO history                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Returns: { actionItems: [...] }
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: scheduler-agent receives:                               │
│  - Agent system prompt (scheduler specialist)                   │
│  - User config: { name: "Alex", timezone: "America/Los_Angeles" }│
│  - Task: "Create reminders for urgent items, schedule for 8am"  │
│         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^│
│         (Orchestrator injected the 8am preference from memory!) │
│  - Previous step output: { actionItems from step_1 }            │
│  - NO memory, NO history                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR composes final response using:                     │
│  - All step results                                             │
│  - User's name for personalization                              │
│  - Memory context for appropriate tone                          │
└─────────────────────────────────────────────────────────────────┘
```

### Memory-Informed Planning

The orchestrator uses memory to inform how it writes task descriptions:

- If memory says "prefers concise responses" → Task: "Create a brief summary (user prefers concise responses)"
- If memory says "works at Acme Corp" → Task: "Search for emails from acme.com domain"
- If memory says "prefers morning reminders at 8am" → Task: "Create reminder for 8am"

This allows sub-agents to act on user preferences without directly accessing the memory store.

### Token Budget Management

Track context size to stay within model limits:

| Context | Budget Components | Typical Limit |
|---------|------------------|---------------|
| Orchestrator | System prompt + memory + agent descriptions | ~8000 tokens |
| Sub-agent | System prompt + task + previous step outputs | ~4000 tokens (varies by agent) |

Implementation should validate context size before each LLM call and truncate or summarize if needed.

---

## Message Context Assembly

### The "Session" Problem

This is an SMS/WhatsApp assistant - there are no traditional sessions:
- No login/logout boundaries
- Messages arrive asynchronously (minutes, hours, or days apart)
- Users expect continuity ("as I mentioned...") and fresh starts
- The LLM is stateless - every call is independent

**Key insight:** The orchestrator doesn't need sessions. It receives well-assembled context for each request. "Session" is really **how much history to include**.

### Architecture

A **Message Handler** sits above the orchestrator and assembles context per inbound message:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INBOUND MESSAGE (SMS / WhatsApp)                     │
└─────────────────────────────────────────┬───────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MESSAGE CONTEXT ASSEMBLER                               │
│                                                                              │
│  1. Identify user (phone number → user record)                              │
│  2. Load user config (name, timezone)                                       │
│  3. Load user memory (facts, preferences)                                   │
│  4. Load conversation history (sliding window)                              │
│  5. Assemble into OrchestratorContext                                       │
│                                                                              │
└─────────────────────────────────────────┬───────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR                                       │
│                                                                              │
│  Receives fully-assembled context. Doesn't care about "sessions".           │
│  Plans and executes based on current context.                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Context Layers

Instead of sessions, context is organized in **layers with different lifetimes**:

| Layer | Lifetime | Storage | Refresh |
|-------|----------|---------|---------|
| System prompt | Static | Code | Every request |
| User config | Permanent | Database | Every request |
| User memory (facts) | Permanent until changed | Database | Every request |
| Conversation history | Sliding window | Database | Every request (windowed) |
| Plan context | Single request | Memory | During orchestration only |

### Conversation History Window

Conversation history uses a sliding window with multiple constraints:

```typescript
interface ConversationWindowConfig {
  maxAgeHours: number;      // e.g., 24 - exclude messages older than this
  maxMessages: number;      // e.g., 20 - cap at N messages
  maxTokens: number;        // e.g., 4000 - stay within token budget
}

const DEFAULT_WINDOW: ConversationWindowConfig = {
  maxAgeHours: 24,
  maxMessages: 20,
  maxTokens: 4000,
};
```

**Window algorithm:**
1. Fetch messages from last `maxAgeHours`
2. If count > `maxMessages`, take most recent
3. If tokens > `maxTokens`, drop oldest messages
4. Return as conversation history array

### Message Storage

```typescript
interface StoredMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  tokenCount?: number;      // Pre-computed for fast budgeting
}

interface MessageStore {
  append(message: StoredMessage): Promise<void>;
  getRecent(userId: string, config: ConversationWindowConfig): Promise<StoredMessage[]>;
}
```

### Multi-Turn Conversations

Multi-turn conversations work through conversation history - no plan state persistence needed:

```
History:
  User: "Check my email"
  Assistant: "You have 3 urgent emails: 1) Report due, 2) Client meeting,
             3) Budget review. Want me to create reminders?"

New message:
  User: "Yes, the first two"

→ Orchestrator sees full context
→ Creates new plan: "Create reminders for Report due and Client meeting"
```

The orchestrator doesn't "resume" old plans - it creates fresh plans informed by conversation context. This works because:
- Assistant responses contain the relevant state (options presented, questions asked)
- User replies reference that context naturally
- The orchestrator sees both and understands the continuation

### Message Handler Flow

```typescript
async function handleInboundMessage(
  userId: string,
  content: string
): Promise<string> {
  // 1. Load all context layers in parallel
  const [userConfig, userMemory, history] = await Promise.all([
    loadUserConfig(userId),
    loadUserMemory(userId),
    loadConversationHistory(userId, DEFAULT_WINDOW),
  ]);

  // 2. Store inbound message
  await messageStore.append({
    id: generateId(),
    userId,
    role: 'user',
    content,
    timestamp: new Date(),
  });

  // 3. Assemble context and run orchestrator
  const response = await orchestrate(content, {
    userConfig,
    userMemory,
    conversationHistory: [...history, { role: 'user', content }],
  });

  // 4. Store response
  await messageStore.append({
    id: generateId(),
    userId,
    role: 'assistant',
    content: response,
    timestamp: new Date(),
  });

  return response;
}
```

### What About Older Conversations?

For references beyond the sliding window ("remember when we discussed X last week?"):

1. **Facts memory handles most cases** - Important information gets extracted to facts by existing background job
2. **If user needs something specific** - They'll re-state it or we ask for clarification
3. **Future enhancement** - Could add explicit search/recall command if needed

No conversation summarization needed - facts + recent messages provides sufficient context.

---

## Dynamic Replanning

### When to Replan

Replanning is triggered when:

1. **Step failure** - A critical step fails and there's an alternative approach
2. **New information** - Step result reveals the original plan won't work
3. **Missing data** - Expected data doesn't exist (e.g., no emails found)
4. **User intent clarified** - Step result clarifies ambiguous request

```typescript
interface ReplanTrigger {
  type: 'step_failed' | 'new_information' | 'missing_data' | 'intent_clarified';
  stepId: string;
  reason: string;
  newContext: Record<string, unknown>;
}

function shouldReplan(result: StepResult, plan: ExecutionPlan, stepIndex: number): boolean {
  // Check for explicit replan signals in result
  if (result.output && typeof result.output === 'object') {
    const output = result.output as Record<string, unknown>;

    // Agent explicitly requests replan
    if (output.needsReplan === true) {
      return true;
    }

    // Empty results and there are more steps that might need this data
    if (output.isEmpty === true && stepIndex < plan.steps.length - 1) {
      return true;
    }
  }

  // Failed step and there are remaining steps
  if (!result.success && stepIndex < plan.steps.length - 1) {
    return true;
  }

  return false;
}
```

### Replan Process

```typescript
async function replan(
  currentPlan: ExecutionPlan,
  trigger: ReplanTrigger['type']
): Promise<ExecutionPlan> {
  const anthropic = getClient();

  currentPlan.status = 'replanning';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `You are revising an execution plan based on new information.

Original request: ${currentPlan.userRequest}

Current plan state:
${formatPlanState(currentPlan)}

Completed steps and results:
${formatCompletedSteps(currentPlan)}

Errors encountered:
${formatErrors(currentPlan)}

Create a revised plan that:
1. Keeps completed steps (don't redo work)
2. Removes or replaces failed/blocked steps
3. Adds new steps if needed
4. Achieves the user's goal with the information now available

Return JSON with the same format as the original plan.`,
    messages: [
      { role: 'user', content: `Replan needed: ${trigger}` }
    ],
  });

  const newPlanJson = extractJson(response);

  // Merge: keep completed steps, add new steps
  const revisedPlan: ExecutionPlan = {
    ...currentPlan,
    steps: mergeSteps(currentPlan.steps, newPlanJson.steps),
    version: currentPlan.version + 1,
    status: 'executing',
    updatedAt: new Date(),
  };

  return revisedPlan;
}

function mergeSteps(existing: PlanStep[], newSteps: PlanStep[]): PlanStep[] {
  const merged: PlanStep[] = [];

  // Keep completed steps
  for (const step of existing) {
    if (step.status === 'completed') {
      merged.push(step);
    }
  }

  // Add new steps (with fresh IDs to avoid conflicts)
  for (const step of newSteps) {
    // Skip if this step duplicates a completed one
    const isDuplicate = merged.some(m =>
      m.agent === step.agent && m.task === step.task
    );

    if (!isDuplicate) {
      merged.push({
        ...step,
        id: `step_${merged.length + 1}_v${Date.now()}`,
        status: 'pending',
        retryCount: 0,
        maxRetries: 2,
      });
    }
  }

  return merged;
}
```

### Replan Limits

To prevent infinite replanning:

```typescript
/** Constraints from requirements (C-1 through C-5) */
const ORCHESTRATOR_LIMITS = {
  maxExecutionTimeMs: 300_000, // C-1: 5 minute hard limit
  maxReplans: 3,               // C-2: Max replan attempts
  maxTotalSteps: 10,           // C-3: Max steps across all plan versions
  maxRetriesPerStep: 2,        // C-4: Default retries per step
  stepTimeoutMs: 120_000,      // C-5: Per-step timeout (2 minutes)
};

function canReplan(plan: ExecutionPlan): boolean {
  return (
    plan.version < ORCHESTRATOR_LIMITS.maxReplans &&
    plan.steps.length < ORCHESTRATOR_LIMITS.maxTotalSteps &&
    Date.now() - plan.createdAt.getTime() < ORCHESTRATOR_LIMITS.maxExecutionTimeMs
  );
}
```

---

## Orchestrator Utility Tools

### Overview

The orchestrator has direct access to **utility tools** that it uses during the planning phase. These are NOT delegated to sub-agents because they:

1. **Need consistency across steps** - Same resolved value used by all sub-agents
2. **Are needed during planning** - Results inform how task descriptions are written
3. **Are deterministic/simple** - Don't require full agent reasoning with tool loops

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR                                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      UTILITY TOOLS (direct access)                   │    │
│  │                                                                      │    │
│  │  • resolve_date       - Convert "friday" → "2026-01-30"             │    │
│  │  • resolve_time_range - Convert "next week" → start/end dates       │    │
│  │  • get_current_time   - Get current time in user's timezone         │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      CONTEXT (read-only access)                      │    │
│  │                                                                      │    │
│  │  • User Memory        - Facts, preferences (injected into tasks)    │    │
│  │  • User Config        - Name, timezone (passed to all agents)       │    │
│  │  • Conversation       - History for context                         │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│                          │ delegates to                                      │
│                          ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      SUB-AGENTS (LLM + tools)                        │    │
│  │                                                                      │    │
│  │  • calendar-agent  - Calendar CRUD operations                       │    │
│  │  • email-agent     - Email read/search                              │    │
│  │  • scheduler-agent - Reminder CRUD operations                       │    │
│  │  • memory-agent    - Memory WRITE operations, complex searches      │    │
│  │  • ui-agent        - Generate interactive pages                     │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Existing Utility Tools

The following tools already exist in the codebase and should be passed to the orchestrator:

| Tool | Location | Purpose |
|------|----------|---------|
| `resolve_date` | `src/llm/tools/resolve-date.ts` | Convert relative dates to ISO dates |
| `resolve_time_range` | `src/llm/tools/resolve-date.ts` | Convert time ranges to start/end timestamps |
| `get_current_time` | (use `buildTimeContext`) | Current time in user's timezone |

These are passed to the orchestrator's API call via the `tools` parameter, just like any other tools. The orchestrator uses them during planning before creating step definitions.

### Memory: Read vs. Write

Memory has a **split responsibility**:

| Operation | Handler | Rationale |
|-----------|---------|-----------|
| **Read memory** | Orchestrator (context) | Memory is already loaded into system prompt; orchestrator uses it to inform task descriptions |
| **Write memory** | memory-agent | Writing requires reasoning about what to store, deduplication, categorization |
| **Complex search** | memory-agent | Semantic search across memories requires LLM reasoning |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MEMORY FLOW                                        │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ ORCHESTRATOR STARTUP                                                 │    │
│  │                                                                      │    │
│  │  1. Load user memory into system prompt (buildMemoryXml)            │    │
│  │  2. Memory is AVAILABLE during planning                              │    │
│  │  3. Orchestrator can reference memory when writing task descriptions │    │
│  │                                                                      │    │
│  │  Example:                                                            │    │
│  │    Memory: "User prefers morning reminders at 8am"                  │    │
│  │    Task: "Create reminder for Friday at 8am (user's preferred time)"│    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ MEMORY-AGENT (sub-agent)                                             │    │
│  │                                                                      │    │
│  │  Used when:                                                          │    │
│  │  • User says "remember that..." → WRITE operation                   │    │
│  │  • User asks "what do you know about..." → COMPLEX SEARCH           │    │
│  │  • Step needs to store discovered information                       │    │
│  │                                                                      │    │
│  │  Tools:                                                              │    │
│  │  • extract_memory  - Parse and store new facts                      │    │
│  │  • search_memory   - Semantic search across memories                │    │
│  │  • update_memory   - Modify existing facts                          │    │
│  │  • remove_memory   - Delete outdated facts                          │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Example: Date Resolution Flow

```
User: "What's on my calendar Friday and remind me about anything important"

┌─────────────────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR - PLANNING PHASE                                               │
│                                                                              │
│  1. Sees "Friday" in request                                                │
│  2. Calls resolve_date("Friday") utility tool                               │
│     → Returns: { resolved: "2026-01-30", dayOfWeek: "Friday" }             │
│                                                                              │
│  3. Creates plan with RESOLVED date in tasks:                               │
│                                                                              │
│     {                                                                        │
│       "steps": [                                                            │
│         {                                                                    │
│           "id": "step_1",                                                   │
│           "agent": "calendar-agent",                                        │
│           "task": "List all events on 2026-01-30 (Friday)"                 │
│                    ^^^^^^^^^^^^^^^^^^                                        │
│                    Resolved date embedded in task!                          │
│         },                                                                   │
│         {                                                                    │
│           "id": "step_2",                                                   │
│           "agent": "scheduler-agent",                                       │
│           "task": "Create reminders for important events on 2026-01-30"    │
│         }                                                                    │
│       ]                                                                      │
│     }                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ EXECUTION (sequential)                                                       │
│                                                                              │
│  Step 1: calendar-agent                                                     │
│          - Task includes resolved date "2026-01-30"                         │
│          - Returns: { events: [...] }                                       │
│                              │                                               │
│                              ▼                                               │
│  Step 2: scheduler-agent                                                    │
│          - Task includes resolved date "2026-01-30"                         │
│          - Receives step_1 results as context                               │
│          - Creates reminders for important events                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

RESULT: Both agents use EXACTLY the same date
        No risk of inconsistency from separate resolution
```

### Utility Tools vs. Agent Tools

| Aspect | Utility Tools | Agent Tools |
|--------|---------------|-------------|
| **When used** | During planning phase | During step execution |
| **Who executes** | Orchestrator directly | Sub-agent via tool loop |
| **LLM calls** | 0-1 (part of planning call) | Multiple (agent's tool loop) |
| **Purpose** | Resolve values for plan | Perform domain operations |
| **Examples** | resolve_date, get_current_time | list_events, create_reminder |

---

## Agent Registry

> **Note:** For detailed agent definitions (prompts, tools, token budgets), see [agent-design.md](agent-design.md#agent-definitions).

The orchestrator uses a registry to look up agents by name:

```typescript
interface AgentDefinition {
  name: string;
  description: string;           // Used by orchestrator to select agent
  capabilities: string[];        // What this agent can do
  tools: Tool[];                 // Anthropic tool definitions
  maxTokens: number;
  systemPrompt: string;
  outputSchema?: {               // Expected output structure
    type: string;
    properties: Record<string, unknown>;
  };
}

const AGENT_REGISTRY: Record<string, AgentDefinition> = {
  'email-agent': { /* see agent-design.md */ },
  'scheduler-agent': { /* see agent-design.md */ },
  'calendar-agent': { /* see agent-design.md */ },
  'ui-agent': { /* see agent-design.md */ },
  'memory-agent': { /* see agent-design.md */ },
};
```

### How Orchestrator Uses the Registry

1. **During planning**: Orchestrator receives agent descriptions to choose appropriate agents
2. **During execution**: Orchestrator looks up agent config by name to run the step
3. **Extensibility**: Adding a new agent only requires adding an entry to the registry (NFR-6)

---

## Implementation

### File Structure

```
src/agents/
├── types.ts              # Type definitions (PlanStep, ExecutionPlan, etc.)
├── registry.ts           # Agent definitions and registry
├── runner.ts             # executeStep() - runs a single agent
├── orchestrator.ts       # Main orchestrate() function
├── planner.ts            # createPlan(), replan()
├── prompts/
│   ├── planning.ts       # Planning prompt template
│   ├── replanning.ts     # Replanning prompt template
│   ├── composition.ts    # Response composition prompt
│   └── agents/
│       ├── email.ts
│       ├── scheduler.ts
│       ├── calendar.ts
│       ├── ui.ts
│       └── memory.ts
└── index.ts              # Exports
```

### Integration Point

The existing `generateResponse()` function routes to the orchestrator for complex requests:

1. **Detection**: Check if request needs orchestration (multiple actions, workflows, multi-step)
2. **Simple path**: Single-agent requests use existing tool loop
3. **Complex path**: Multi-agent requests route to `orchestrate()`

**Heuristics for orchestration:**
- Multiple distinct actions ("check email AND create reminder")
- Complex workflows ("summarize my week")
- Multi-step requests ("find X, then do Y with it")

---

## Examples

### Example 1: Simple Request (No Orchestration)

**User:** "Hi, how are you?"

**Orchestrator Decision:** No orchestration needed (no tool use)

**Response:** Direct LLM response

---

### Example 2: Single-Agent Request

**User:** "What's on my calendar tomorrow?"

**Plan:**
```json
{
  "analysis": "User wants to see tomorrow's calendar events",
  "steps": [
    {
      "id": "step_1",
      "agent": "calendar-agent",
      "task": "List all calendar events for tomorrow"
    }
  ],
  "responseHint": "List the events in a friendly format"
}
```

**Execution:** Single step, calendar-agent returns events

**Response:** "Tomorrow you have: 9am Team standup, 2pm Client call"

---

### Example 3: Multi-Step Request

**User:** "Check my email and create reminders for anything urgent"

**Plan:**
```json
{
  "analysis": "User wants email scan + reminder creation for urgent items",
  "steps": [
    {
      "id": "step_1",
      "agent": "email-agent",
      "task": "Search recent emails, identify urgent items with deadlines"
    },
    {
      "id": "step_2",
      "agent": "scheduler-agent",
      "task": "Create reminders for each urgent item found"
    }
  ],
  "responseHint": "Summarize emails checked and reminders created"
}
```

**Execution:**
```
Step 1: email-agent
        │
        │ Returns: { actionItems: [...] }
        ▼
Step 2: scheduler-agent (receives step_1 results as context)
```

1. email-agent finds 2 urgent emails with deadlines
2. scheduler-agent creates 2 reminders (receives step_1 output automatically)

**Response:** "Found 2 urgent emails. Created reminders for: Report due Friday (reminder Thu 9am), Client proposal due Wed (reminder Tue 9am)"

---

### Example 4: Replan Scenario

**User:** "Show me my reminders in an editable web page"

**Initial Plan:**
```json
{
  "steps": [
    { "id": "step_1", "agent": "scheduler-agent", "task": "List all reminders with full details" },
    { "id": "step_2", "agent": "ui-agent", "task": "Create editable reminder interface" }
  ]
}
```

**Execution:**
1. scheduler-agent returns: `{ "jobs": [], "isEmpty": true }`

**Replan Triggered:** Empty results, next step can't proceed meaningfully

**Revised Plan:**
```json
{
  "steps": [
    { "id": "step_1", "status": "completed", "result": { "jobs": [] } },
    { "id": "step_2_v2", "agent": "ui-agent", "task": "Create empty state UI explaining no reminders exist, with option to create one" }
  ]
}
```

**Response:** "You don't have any reminders set up yet! Here's a page where you can create your first one: [link]"

---

## Open Questions

1. **Token budgeting** - Should orchestrator track total tokens and adjust agent budgets?
   - Could dynamically reduce max_tokens for later steps if running low

2. **Caching** - Should step results be cached for similar future requests?
   - E.g., "what's on my calendar" result valid for 5 minutes

3. **User confirmation** - Should orchestrator ask user to confirm plan before executing?
   - Maybe for destructive actions (delete event, remove reminder)
   - Could add `requiresConfirmation: boolean` to step definition

4. **Plan visibility** - Should user see the plan before/during execution?
   - "I'll check your email, then create reminders..."

---

## Next Steps

1. [ ] Implement core types (`types.ts`)
2. [ ] Create agent registry with prompts
3. [ ] Implement `executeStep()` runner
4. [ ] Implement `createPlan()` planner
5. [ ] Implement execution loop
6. [ ] Add replanning logic
7. [ ] Integrate with existing `generateResponse()`
8. [ ] Add tests for plan/execute/replan cycles
