/**
 * Agent Type Definitions
 *
 * Core types for the agent system. Agents are independent workers
 * that execute specific tasks using tools.
 */

import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { UserConfig } from '../services/user-config/types.js';
import type { TraceLogger } from '../utils/trace-logger.js';

// ============================================================================
// Step Result Types
// ============================================================================

/**
 * Result from executing a step/task.
 * Captures success/failure, output data, and observability info.
 */
export interface StepResult {
  /** Whether the step completed successfully */
  success: boolean;

  /** Structured output from the agent (can be any shape) */
  output: unknown;

  /** Tool calls made during execution (for observability) */
  toolCalls?: ToolUseBlock[];

  /** Error message if the step failed */
  error?: string;

  /** Token usage for budget tracking */
  tokenUsage?: {
    input: number;
    output: number;
  };
}

// ============================================================================
// Agent Capability Types
// ============================================================================

/**
 * Definition of an agent's capabilities.
 * Used by the planner to select appropriate agents for tasks.
 */
export interface AgentCapability {
  /** Unique agent name (e.g., "calendar-agent") */
  name: string;

  /** Human-readable description for the planner */
  description: string;

  /** List of tool names this agent can use ('*' means all tools) */
  tools: string[];

  /** Example tasks this agent handles (helps planner understand scope) */
  examples: string[];

  /** Expected output structure (for documentation/validation) */
  outputSchema?: {
    type: string;
    properties: Record<string, unknown>;
  };
}

/**
 * Registry interface for looking up agents.
 */
export interface AgentRegistry {
  /** Get an agent by name */
  getAgent(name: string): AgentCapability | undefined;

  /** List all registered agents */
  listAgents(): AgentCapability[];
}

// ============================================================================
// Agent Execution Types
// ============================================================================

/**
 * Context passed to agent executors.
 */
export interface AgentExecutionContext {
  /** User's phone number */
  phoneNumber: string;

  /** Message channel */
  channel: 'sms' | 'whatsapp';

  /** User configuration (name, timezone) */
  userConfig: UserConfig | null;

  /** Results from previous steps (for context passing) */
  previousStepResults: Record<string, StepResult>;

  /** Trace logger for debugging (optional, only present in development) */
  logger?: TraceLogger;
}

/**
 * Function signature for agent executors.
 */
export type AgentExecutor = (
  task: string,
  context: AgentExecutionContext
) => Promise<StepResult>;
