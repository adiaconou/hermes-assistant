/**
 * Main Orchestrator
 *
 * The primary entry point for the orchestration system. This function:
 * 1. Creates an execution plan from the user's message
 * 2. Executes steps sequentially
 * 3. Handles retries and replanning
 * 4. Returns the final response
 *
 * This is the function that message handlers call to process complex requests.
 */

import type { ConversationMessage, StoredMediaAttachment } from '../services/conversation/types.js';
import type { UserFact } from '../services/memory/types.js';
import type { UserConfig } from '../services/user-config/types.js';
import type {
  ExecutionPlan,
  PlanContext,
  OrchestratorResult,
  StepResult,
  MediaAttachment,
} from './types.js';
import { ORCHESTRATOR_LIMITS } from './types.js';
import { createAgentRegistry } from '../executor/registry.js';
import { getRelevantHistory } from './conversation-window.js';
import { createPlan } from './planner.js';
import { executeStep, shouldReplan } from './executor.js';
import { replan, canReplan } from './replanner.js';
import { synthesizeResponse } from './response-composer.js';
import type { TraceLogger } from '../utils/trace-logger.js';

/**
 * Log a plan-level event.
 */
function logPlanEvent(
  event: string,
  plan: ExecutionPlan,
  extra?: Record<string, unknown>
): void {
  console.log(JSON.stringify({
    event,
    planId: plan.id,
    version: plan.version,
    status: plan.status,
    stepCount: plan.steps.length,
    ...extra,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Log a step-level event.
 */
function logStepEvent(
  event: string,
  plan: ExecutionPlan,
  stepId: string,
  agent: string,
  extra?: Record<string, unknown>
): void {
  console.log(JSON.stringify({
    event,
    planId: plan.id,
    stepId,
    agent,
    ...extra,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Main orchestration function.
 *
 * Takes a user message and context, creates a plan, executes it,
 * and returns the final response.
 *
 * @param userMessage The user's message to process
 * @param conversationHistory Full conversation history (will be windowed)
 * @param userFacts User's stored facts/preferences
 * @param userConfig User configuration (name, timezone)
 * @param logger Trace logger for debugging
 * @returns OrchestratorResult with response and execution details
 */
export async function orchestrate(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  userFacts: UserFact[],
  userConfig: UserConfig | null,
  phoneNumber: string,
  channel: 'sms' | 'whatsapp',
  logger: TraceLogger,
  mediaAttachments?: MediaAttachment[],
  storedMedia?: StoredMediaAttachment[]
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const registry = createAgentRegistry();

  console.log(JSON.stringify({
    level: 'info',
    message: 'Starting orchestration',
    userMessageLength: userMessage.length,
    historyLength: conversationHistory.length,
    factsCount: userFacts.length,
    hasUserConfig: !!userConfig,
    timestamp: new Date().toISOString(),
  }));

  // Build initial context
  const context: PlanContext = {
    userMessage,
    conversationHistory: getRelevantHistory(conversationHistory),
    userFacts,
    userConfig,
    phoneNumber,
    channel,
    mediaAttachments,
    storedMedia,
    stepResults: {},
    errors: [],
  };

  try {
    // Phase 1: Create the initial plan
    logger.log('INFO', 'Creating execution plan');
    let plan = await createPlan(context, registry, logger);
    logPlanEvent('plan_created', plan);
    logger.planEvent('created', {
      'Plan ID': plan.id,
      Goal: plan.goal,
      Steps: plan.steps.length,
    });

    // Handle empty plan (no steps needed)
    if (plan.steps.length === 0) {
      logPlanEvent('plan_empty', plan);
      return {
        success: true,
        response: await synthesizeResponse(context, plan, undefined, logger),
        stepResults: {},
        plan,
      };
    }

    // Phase 2: Execute steps sequentially
    let currentStepIndex = 0;

    while (currentStepIndex < plan.steps.length) {
      // Check plan-level timeout (C-1: 2 minute limit)
      const elapsed = Date.now() - startTime;
      if (elapsed > ORCHESTRATOR_LIMITS.maxExecutionTimeMs) {
        logPlanEvent('plan_timeout', plan, { elapsedMs: elapsed });
        logger.planEvent('timeout', { 'Elapsed ms': elapsed });
        plan.status = 'failed';

        return {
          success: false,
          response: await synthesizeResponse(context, plan, 'timeout', logger),
          stepResults: context.stepResults,
          error: `Execution timeout after ${Math.round(elapsed / 1000)}s`,
          plan,
        };
      }

      const step = plan.steps[currentStepIndex];

      // Skip already completed steps (from replanning)
      if (step.status === 'completed') {
        currentStepIndex++;
        continue;
      }

      // Execute the step
      step.status = 'running';
      logStepEvent('step_started', plan, step.id, step.agent, {
        retryCount: step.retryCount,
      });
      logger.stepEvent('start', step.id, step.agent, {
        Task: step.task,
        'Retry count': step.retryCount,
      });

      const result = await executeStep(step, context, registry, logger);

      if (result.success) {
        // Success - move to next step
        step.status = 'completed';
        step.result = result;
        context.stepResults[step.id] = result;

        logStepEvent('step_completed', plan, step.id, step.agent, {
          hasOutput: !!result.output,
          toolCallCount: result.toolCalls?.length || 0,
        });
        logger.stepEvent('complete', step.id, step.agent, {
          Success: true,
          'Tool calls': result.toolCalls?.length || 0,
          'Duration ms': result.tokenUsage ? undefined : undefined, // Duration tracked elsewhere
        });

        // Check if agent signaled replanning
        const needsReplan = shouldReplan(result, currentStepIndex, plan.steps.length);
        if (needsReplan && canReplan(plan)) {
          logPlanEvent('plan_replanning', plan, {
            reason: 'agent_requested_replan',
            failedStepId: step.id,
          });
          logger.planEvent('replanning', {
            Reason: 'agent_requested_replan',
            'Failed step': step.id,
          });
          plan = await replan(plan, context, registry, logger);
          logPlanEvent('plan_replanned', plan, {
            newStepCount: plan.steps.length,
          });
          logger.planEvent('replanned', {
            'New step count': plan.steps.length,
          });
          currentStepIndex = plan.steps.findIndex(s => s.status === 'pending');
          if (currentStepIndex < 0) {
            break;
          }
        } else {
          currentStepIndex++;
        }
      } else {
        // Failure - retry or replan
        step.retryCount++;
        context.errors.push({
          stepId: step.id,
          error: result.error || 'Unknown error',
        });
        context.stepResults[step.id] = result;

        logStepEvent('step_failed', plan, step.id, step.agent, {
          error: result.error,
          retryCount: step.retryCount,
        });
        logger.stepEvent('failed', step.id, step.agent, {
          Error: result.error,
          'Retry count': step.retryCount,
        });

        if (step.retryCount < step.maxRetries) {
          // Retry the same step
          logStepEvent('step_retrying', plan, step.id, step.agent, {
            retryCount: step.retryCount,
          });
          logger.stepEvent('retry', step.id, step.agent, {
            'Attempt': step.retryCount + 1,
            'Max retries': step.maxRetries,
          });
          continue;
        }

        // Max retries exceeded - try replanning
        if (canReplan(plan)) {
          logPlanEvent('plan_replanning', plan, {
            reason: result.error,
            failedStepId: step.id,
          });
          logger.planEvent('replanning', {
            Reason: result.error,
            'Failed step': step.id,
          });

          step.status = 'failed';
          step.result = result;
          plan = await replan(plan, context, registry, logger);

          logPlanEvent('plan_replanned', plan, {
            newStepCount: plan.steps.length,
          });
          logger.planEvent('replanned', {
            'New step count': plan.steps.length,
          });

          // Find the first pending step to continue from
          currentStepIndex = plan.steps.findIndex(s => s.status === 'pending');
          if (currentStepIndex < 0) {
            // No more steps to execute
            break;
          }
          continue;
        }

        // Cannot replan - fail the plan
        step.status = 'failed';
        step.result = result;
        plan.status = 'failed';

        logPlanEvent('plan_failed', plan, {
          reason: 'max_replans_exceeded',
          failedStepId: step.id,
        });
        logger.planEvent('failed', {
          Reason: 'max_replans_exceeded',
          'Failed step': step.id,
        });

        return {
          success: false,
          response: await synthesizeResponse(context, plan, 'step_failed', logger),
          stepResults: context.stepResults,
          error: result.error || 'Step failed after max retries',
          plan,
        };
      }
    }

    // Phase 3: All steps completed successfully
    plan.status = 'completed';
    plan.updatedAt = new Date();

    const totalDuration = Date.now() - startTime;
    logPlanEvent('plan_completed', plan, {
      totalDurationMs: totalDuration,
      completedSteps: plan.steps.filter(s => s.status === 'completed').length,
    });
    logger.planEvent('completed', {
      'Total duration ms': totalDuration,
      'Completed steps': plan.steps.filter(s => s.status === 'completed').length,
    });

    logger.log('INFO', 'Composing final response');
    return {
      success: true,
      response: await synthesizeResponse(context, plan, undefined, logger),
      stepResults: context.stepResults,
      plan,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(JSON.stringify({
      level: 'error',
      message: 'Orchestration failed with exception',
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    return {
      success: false,
      response: 'I encountered an unexpected error. Please try again.',
      stepResults: context.stepResults,
      error: errorMessage,
    };
  }
}
