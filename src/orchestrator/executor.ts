/**
 * Step Executor
 *
 * Executes individual plan steps by invoking the appropriate agent.
 * This is the bridge between the orchestrator's planning and the
 * agents' tool-calling capabilities.
 *
 * Key responsibilities:
 * - Look up agent from registry
 * - Build step prompt with previous results
 * - Execute with timeout
 * - Return structured result
 */

import type {
  PlanStep,
  PlanContext,
  AgentRegistry,
} from './types.js';
import { ORCHESTRATOR_LIMITS } from './types.js';
import type { StepResult, AgentExecutionContext } from '../executor/types.js';
import { routeToAgent } from '../executor/router.js';
import { getSkillsRegistry } from '../registry/skills.js';
import type { TraceLogger } from '../utils/trace-logger.js';

/** Per-step timeout from design constraints (C-5) */
const STEP_TIMEOUT_MS = ORCHESTRATOR_LIMITS.stepTimeoutMs;

/**
 * Wrap a promise with a timeout.
 * Uses Promise.race to cleanly settle on whichever completes first,
 * and always clears the timer to avoid resource leaks.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Step execution timeout after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Execute a single plan step.
 *
 * @param step The step to execute
 * @param context Plan context with previous results
 * @param registry Agent registry for looking up agent config
 * @param logger Trace logger for debugging
 * @returns StepResult with success/output/error
 */
export async function executeStep(
  step: PlanStep,
  context: PlanContext,
  registry: AgentRegistry,
  logger?: TraceLogger
): Promise<StepResult> {
  const startTime = Date.now();

  const targetType = step.targetType || 'agent';

  console.log(JSON.stringify({
    level: 'info',
    message: 'Executing step',
    stepId: step.id,
    targetType,
    agent: step.agent,
    taskPreview: step.task.substring(0, 100),
    timestamp: new Date().toISOString(),
  }));

  // Build execution context
  const executionContext: AgentExecutionContext = {
    phoneNumber: context.phoneNumber,
    channel: context.channel,
    userConfig: context.userConfig,
    userFacts: context.userFacts,
    previousStepResults: context.stepResults,
    mediaAttachments: context.mediaAttachments,
    storedMedia: context.storedMedia,
    messageId: context.messageId,
    mediaContext: context.mediaContext,
    logger,
  };

  // Skill dispatch path
  if (targetType === 'skill') {
    try {
      const skillsRegistry = getSkillsRegistry();
      const result = await withTimeout(
        skillsRegistry.executeByName(step.agent, step.task, executionContext),
        STEP_TIMEOUT_MS
      );

      const durationMs = Date.now() - startTime;

      console.log(JSON.stringify({
        level: 'info',
        message: 'Skill step completed',
        stepId: step.id,
        skill: step.agent,
        success: result.success,
        durationMs,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: result.success,
        output: result.output,
        error: result.error,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(JSON.stringify({
        level: 'error',
        message: 'Skill step execution failed',
        stepId: step.id,
        skill: step.agent,
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: false,
        output: null,
        error: errorMessage,
      };
    }
  }

  // Agent dispatch path
  const agent = registry.getAgent(step.agent);
  if (!agent) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Unknown agent',
      stepId: step.id,
      agent: step.agent,
      timestamp: new Date().toISOString(),
    }));

    return {
      success: false,
      output: null,
      error: `Unknown agent: ${step.agent}`,
    };
  }

  try {
    // Route to the appropriate agent with timeout
    const result = await withTimeout(
      routeToAgent(step.agent, step.task, executionContext),
      STEP_TIMEOUT_MS
    );

    const durationMs = Date.now() - startTime;

    console.log(JSON.stringify({
      level: 'info',
      message: 'Step completed',
      stepId: step.id,
      agent: step.agent,
      success: result.success,
      hasError: !!result.error,
      toolCallCount: result.toolCalls?.length || 0,
      durationMs,
      timestamp: new Date().toISOString(),
    }));

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('timeout');

    console.error(JSON.stringify({
      level: 'error',
      message: isTimeout ? 'Step timeout' : 'Step execution failed',
      stepId: step.id,
      agent: step.agent,
      error: errorMessage,
      durationMs,
      timestamp: new Date().toISOString(),
    }));

    return {
      success: false,
      output: null,
      error: errorMessage,
    };
  }
}

/**
 * Check if a step result indicates a need for replanning.
 *
 * Replanning is triggered when:
 * - Step explicitly requests replan (output.needsReplan === true)
 * - Step returns empty results and there are more steps (output.isEmpty === true)
 * - Step failed and there are remaining steps
 */
export function shouldReplan(
  result: StepResult,
  stepIndex: number,
  totalSteps: number
): boolean {
  // Check for explicit replan signals
  if (result.output && typeof result.output === 'object') {
    const output = result.output as Record<string, unknown>;

    if (output.needsReplan === true) {
      return true;
    }

    // Empty results with more steps ahead
    if (output.isEmpty === true && stepIndex < totalSteps - 1) {
      return true;
    }
  }

  // Failed step with remaining steps
  if (!result.success && stepIndex < totalSteps - 1) {
    return true;
  }

  return false;
}

/**
 * Format a step result for logging/debugging.
 */
export function formatStepResult(step: PlanStep, result: StepResult): string {
  const status = result.success ? 'SUCCESS' : 'FAILED';
  const error = result.error ? ` - Error: ${result.error}` : '';
  const tools = result.toolCalls?.length
    ? ` - Tools: ${result.toolCalls.map(t => t.name).join(', ')}`
    : '';

  return `[${step.id}] ${step.agent}: ${status}${error}${tools}`;
}
