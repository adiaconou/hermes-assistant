/**
 * Orchestrator Type Definitions
 *
 * Core types for the orchestrator system that plans, delegates,
 * tracks, and dynamically adjusts execution of complex user requests.
 */

import type { ConversationMessage } from '../services/conversation/types.js';
import type { UserFact } from '../services/memory/types.js';
import type { UserConfig } from '../services/user-config/types.js';

// Re-export agent types for backwards compatibility
export type {
  StepResult,
  AgentCapability,
  AgentRegistry,
  AgentExecutionContext,
  AgentExecutor,
} from '../executor/types.js';

// Import StepResult for use in this file
import type { StepResult } from '../executor/types.js';

// ============================================================================
// Step Types
// ============================================================================

/**
 * Status of a plan step.
 * State machine: pending → running → completed | failed
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * A single step in the execution plan.
 */
export interface PlanStep {
  /** Unique identifier (e.g., "step_1") */
  id: string;

  /** Which agent handles this step (e.g., "calendar-agent") */
  agent: string;

  /** Natural language description of the task */
  task: string;

  /** Current status of this step */
  status: StepStatus;

  /** Result after execution (populated when completed/failed) */
  result?: StepResult;

  /** Number of retry attempts made */
  retryCount: number;

  /** Maximum retries before marking as failed (default: 2) */
  maxRetries: number;
}

// ============================================================================
// Plan Types
// ============================================================================

/**
 * Status of the overall execution plan.
 */
export type PlanStatus = 'planning' | 'executing' | 'replanning' | 'completed' | 'failed';

/**
 * Context accumulated during plan execution.
 * Passed to subsequent steps and used for replanning.
 */
export interface PlanContext {
  /** Original user message */
  userMessage: string;

  /** Relevant conversation history (windowed) */
  conversationHistory: ConversationMessage[];

  /** User's stored facts/preferences */
  userFacts: UserFact[];

  /** User configuration (name, timezone) */
  userConfig: UserConfig | null;

  /** User's phone number */
  phoneNumber: string;

  /** Message channel */
  channel: 'sms' | 'whatsapp';

  /** Results from completed steps, keyed by step ID */
  stepResults: Record<string, StepResult>;

  /** Errors encountered during execution */
  errors: Array<{ stepId: string; error: string }>;
}

/**
 * The complete execution plan.
 */
export interface ExecutionPlan {
  /** Unique plan ID for tracking */
  id: string;

  /** Original user request */
  userRequest: string;

  /** Brief description of the plan's goal */
  goal: string;

  /** Ordered list of steps to execute */
  steps: PlanStep[];

  /** Current plan status */
  status: PlanStatus;

  /** Accumulated context from execution */
  context: PlanContext;

  /** Version number (incremented on each replan) */
  version: number;

  /** When the plan was created */
  createdAt: Date;

  /** When the plan was last updated */
  updatedAt: Date;
}

// ============================================================================
// Conversation Window Types
// ============================================================================

/**
 * Configuration for the conversation history sliding window.
 * Multiple constraints applied in order: age → count → tokens.
 */
export interface ConversationWindowConfig {
  /** Exclude messages older than this (hours) */
  maxAgeHours: number;

  /** Maximum number of messages to include */
  maxMessages: number;

  /** Maximum total tokens for history */
  maxTokens: number;
}

/**
 * Default conversation window configuration.
 * Matches design doc values: 24h, 20 messages, 4000 tokens.
 */
export const DEFAULT_CONVERSATION_WINDOW: ConversationWindowConfig = {
  maxAgeHours: 24,
  maxMessages: 20,
  maxTokens: 4000,
};

// ============================================================================
// Orchestrator Result Types
// ============================================================================

/**
 * Result returned by the orchestrator.
 */
export interface OrchestratorResult {
  /** Whether the orchestration completed successfully */
  success: boolean;

  /** Final response to send to the user */
  response: string;

  /** Results from all executed steps */
  stepResults: Record<string, StepResult>;

  /** Error message if orchestration failed */
  error?: string;

  /** The execution plan (for debugging/observability) */
  plan?: ExecutionPlan;
}

// ============================================================================
// Orchestrator Limits
// ============================================================================

/**
 * Constraint values from the design doc.
 */
export const ORCHESTRATOR_LIMITS = {
  /** C-1: Maximum plan execution time (2 minutes) */
  maxExecutionTimeMs: 120_000,

  /** C-2: Maximum replan attempts per request */
  maxReplans: 3,

  /** C-3: Maximum total steps across all plan versions */
  maxTotalSteps: 10,

  /** C-4: Default retries per step */
  maxRetriesPerStep: 2,

  /** C-5: Per-step timeout (60 seconds) */
  stepTimeoutMs: 60_000,
} as const;
