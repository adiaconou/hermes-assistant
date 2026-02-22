/**
 * Unit tests for the replanner module.
 *
 * Tests dynamic replanning after step failures.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setMockResponses,
  createTextResponse,
  clearMockState,
} from '../../mocks/anthropic.js';

// Mock dependencies
vi.mock('../../../src/executor/registry.js', () => ({
  formatAgentsForPrompt: vi.fn(() => `  - calendar-agent: Manages calendar
  - memory-agent: Memory tasks`),
}));

// Import after mocks
import { canReplan, replan } from '../../../src/orchestrator/replanner.js';
import type { ExecutionPlan, PlanContext, AgentRegistry } from '../../../src/orchestrator/types.js';
import { ORCHESTRATOR_LIMITS } from '../../../src/orchestrator/types.js';

describe('canReplan', () => {
  const createBasePlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
    id: 'plan_123',
    userRequest: 'Test request',
    goal: 'Test goal',
    steps: [],
    status: 'executing',
    context: {
      userMessage: 'Test',
      conversationHistory: [],
      userFacts: [],
      userConfig: null,
      phoneNumber: '+1234567890',
      channel: 'sms',
      stepResults: {},
      errors: [],
    },
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('version limit', () => {
    it('should allow replan when under version limit', () => {
      const plan = createBasePlan({ version: 1 });

      expect(canReplan(plan)).toBe(true);
    });

    it('should allow replan at version limit boundary', () => {
      // maxReplans is 3, so version 3 should still allow one more replan
      const plan = createBasePlan({ version: ORCHESTRATOR_LIMITS.maxReplans });

      expect(canReplan(plan)).toBe(true);
    });

    it('should deny replan when over version limit', () => {
      // Version 4 means we've already done 3 replans
      const plan = createBasePlan({ version: ORCHESTRATOR_LIMITS.maxReplans + 1 });

      expect(canReplan(plan)).toBe(false);
    });
  });

  describe('step limit', () => {
    it('should allow replan when under step limit', () => {
      const plan = createBasePlan({
        steps: Array(5).fill({
          id: 'step_1',
          agent: 'memory-agent',
          task: 'Task',
          status: 'pending' as const,
          retryCount: 0,
          maxRetries: 2,
        }),
      });

      expect(canReplan(plan)).toBe(true);
    });

    it('should deny replan when at step limit', () => {
      const plan = createBasePlan({
        steps: Array(ORCHESTRATOR_LIMITS.maxTotalSteps).fill({
          id: 'step_1',
          agent: 'memory-agent',
          task: 'Task',
          status: 'pending' as const,
          retryCount: 0,
          maxRetries: 2,
        }),
      });

      expect(canReplan(plan)).toBe(false);
    });
  });

  describe('time limit', () => {
    it('should allow replan when under time limit', () => {
      const plan = createBasePlan({
        createdAt: new Date(), // Just created
      });

      expect(canReplan(plan)).toBe(true);
    });

    it('should deny replan when over time limit', () => {
      const plan = createBasePlan({
        createdAt: new Date(Date.now() - ORCHESTRATOR_LIMITS.maxExecutionTimeMs - 1000),
      });

      expect(canReplan(plan)).toBe(false);
    });
  });

  describe('combined constraints', () => {
    it('should require all constraints to pass', () => {
      // Version OK, steps OK, but time exceeded
      const plan = createBasePlan({
        version: 1,
        steps: [],
        createdAt: new Date(Date.now() - ORCHESTRATOR_LIMITS.maxExecutionTimeMs - 1000),
      });

      expect(canReplan(plan)).toBe(false);
    });
  });
});

describe('replan', () => {
  const mockRegistry: AgentRegistry = {
    getAgent: vi.fn((name: string) => ({
      name,
      description: `${name} description`,
      tools: ['*'],
      examples: [],
    })),
    listAgents: vi.fn(() => [
      { name: 'calendar-agent', description: 'Calendar', tools: [], examples: [] },
      { name: 'memory-agent', description: 'Memory', tools: [], examples: [] },
    ]),
  };

  const createBasePlan = (): ExecutionPlan => ({
    id: 'plan_123',
    userRequest: 'Check my calendar and send email',
    goal: 'Check calendar and send summary email',
    steps: [
      {
        id: 'step_1',
        agent: 'calendar-agent',
        task: 'Get calendar events',
        status: 'completed',
        result: { success: true, output: 'Found 3 events' },
        retryCount: 0,
        maxRetries: 2,
      },
      {
        id: 'step_2',
        agent: 'email-agent',
        task: 'Send email summary',
        status: 'failed',
        result: { success: false, error: 'Email service unavailable' },
        retryCount: 2,
        maxRetries: 2,
      },
    ],
    status: 'replanning',
    context: {
      userMessage: 'Check my calendar and send email',
      conversationHistory: [],
      userFacts: [],
      userConfig: null,
      phoneNumber: '+1234567890',
      channel: 'sms',
      stepResults: {
        step_1: { success: true, output: 'Found 3 events' },
      },
      errors: [{ stepId: 'step_2', error: 'Email service unavailable' }],
    },
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const createBaseContext = (): PlanContext => ({
    userMessage: 'Check my calendar and send email',
    conversationHistory: [],
    userFacts: [],
    userConfig: null,
    phoneNumber: '+1234567890',
    channel: 'sms',
    stepResults: {
      step_1: { success: true, output: 'Found 3 events' },
    },
    errors: [{ stepId: 'step_2', error: 'Email service unavailable' }],
  });

  beforeEach(() => {
    clearMockState();
  });

  it('should preserve completed steps', async () => {
    setMockResponses([
      createTextResponse(JSON.stringify({
        analysis: 'Email failed, will try SMS instead',
        steps: [
          { id: 'step_1', agent: 'calendar-agent', task: 'Get calendar events', status: 'completed' },
          { id: 'step_3', agent: 'memory-agent', task: 'Send SMS summary' },
        ],
      })),
    ]);

    const priorPlan = createBasePlan();
    const context = createBaseContext();

    const revisedPlan = await replan(priorPlan, context, mockRegistry);

    // Should have the completed step preserved
    const completedStep = revisedPlan.steps.find(s => s.id === 'step_1');
    expect(completedStep).toBeDefined();
    expect(completedStep?.status).toBe('completed');
    expect(completedStep?.result).toEqual({ success: true, output: 'Found 3 events' });
  });

  it('should add new pending steps from LLM response', async () => {
    setMockResponses([
      createTextResponse(JSON.stringify({
        analysis: 'Adding alternative approach',
        steps: [
          { id: 'step_1', agent: 'calendar-agent', task: 'Get calendar events', status: 'completed' },
          { id: 'step_new', agent: 'memory-agent', task: 'New alternative task' },
        ],
      })),
    ]);

    const priorPlan = createBasePlan();
    const context = createBaseContext();

    const revisedPlan = await replan(priorPlan, context, mockRegistry);

    // Should have the new step
    const newStep = revisedPlan.steps.find(s => s.task === 'New alternative task');
    expect(newStep).toBeDefined();
    expect(newStep?.status).toBe('pending');
    expect(newStep?.retryCount).toBe(0);
  });

  it('should increment version number', async () => {
    setMockResponses([
      createTextResponse(JSON.stringify({
        analysis: 'Replanning',
        steps: [],
      })),
    ]);

    const priorPlan = createBasePlan();
    const context = createBaseContext();

    const revisedPlan = await replan(priorPlan, context, mockRegistry);

    expect(revisedPlan.version).toBe(priorPlan.version + 1);
  });

  it('should update timestamps', async () => {
    setMockResponses([
      createTextResponse(JSON.stringify({
        analysis: 'Replanning',
        steps: [],
      })),
    ]);

    const priorPlan = createBasePlan();
    const context = createBaseContext();

    const before = new Date();
    const revisedPlan = await replan(priorPlan, context, mockRegistry);
    const after = new Date();

    expect(revisedPlan.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(revisedPlan.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('should set status to executing', async () => {
    setMockResponses([
      createTextResponse(JSON.stringify({
        analysis: 'Replanning',
        steps: [],
      })),
    ]);

    const priorPlan = createBasePlan();
    const context = createBaseContext();

    const revisedPlan = await replan(priorPlan, context, mockRegistry);

    expect(revisedPlan.status).toBe('executing');
  });

  it('should handle JSON in markdown code blocks', async () => {
    setMockResponses([
      createTextResponse('```json\n{"analysis": "Replanning", "steps": [{"id": "step_new", "agent": "memory-agent", "task": "New task"}]}\n```'),
    ]);

    const priorPlan = createBasePlan();
    const context = createBaseContext();

    const revisedPlan = await replan(priorPlan, context, mockRegistry);

    // Should have parsed the JSON and added the new step
    const newStep = revisedPlan.steps.find(s => s.task === 'New task');
    expect(newStep).toBeDefined();
  });

  it('should enforce step cap', async () => {
    // Create a response with many steps
    const manySteps = Array.from({ length: 15 }, (_, i) => ({
      id: `step_${i + 1}`,
      agent: 'memory-agent',
      task: `Task ${i + 1}`,
    }));

    setMockResponses([
      createTextResponse(JSON.stringify({
        analysis: 'Many steps',
        steps: manySteps,
      })),
    ]);

    const priorPlan = { ...createBasePlan(), steps: [] }; // No completed steps
    const context = createBaseContext();

    const revisedPlan = await replan(priorPlan, context, mockRegistry);

    // Should be capped at maxTotalSteps
    expect(revisedPlan.steps.length).toBeLessThanOrEqual(ORCHESTRATOR_LIMITS.maxTotalSteps);
  });

  it('should not duplicate completed steps', async () => {
    setMockResponses([
      createTextResponse(JSON.stringify({
        analysis: 'Replanning',
        steps: [
          // LLM includes completed step again
          { id: 'step_1', agent: 'calendar-agent', task: 'Get calendar events', status: 'completed' },
          { id: 'step_1_dup', agent: 'calendar-agent', task: 'Get calendar events' }, // Duplicate task
        ],
      })),
    ]);

    const priorPlan = createBasePlan();
    const context = createBaseContext();

    const revisedPlan = await replan(priorPlan, context, mockRegistry);

    // Should only have one step with the calendar task
    const calendarSteps = revisedPlan.steps.filter(
      s => s.agent === 'calendar-agent' && s.task === 'Get calendar events'
    );
    expect(calendarSteps).toHaveLength(1);
  });

  it('should preserve plan ID', async () => {
    setMockResponses([
      createTextResponse(JSON.stringify({
        analysis: 'Replanning',
        steps: [],
      })),
    ]);

    const priorPlan = createBasePlan();
    const context = createBaseContext();

    const revisedPlan = await replan(priorPlan, context, mockRegistry);

    expect(revisedPlan.id).toBe(priorPlan.id);
  });

  it('should handle parse errors gracefully', async () => {
    setMockResponses([
      createTextResponse('This is not valid JSON'),
    ]);

    const priorPlan = createBasePlan();
    const context = createBaseContext();

    const revisedPlan = await replan(priorPlan, context, mockRegistry);

    // Should still return a plan with completed steps preserved
    expect(revisedPlan.id).toBe(priorPlan.id);
    expect(revisedPlan.version).toBe(priorPlan.version + 1);
    // Completed steps should be preserved
    const completedStep = revisedPlan.steps.find(s => s.status === 'completed');
    expect(completedStep).toBeDefined();
  });
});
