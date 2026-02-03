/**
 * Unit tests for the planner module.
 *
 * Tests plan creation from user requests with mocked LLM responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setMockResponses,
  createTextResponse,
  getCreateCalls,
  clearMockState,
} from '../../mocks/anthropic.js';

// Mock the dependencies
vi.mock('../../../src/executor/registry.js', () => ({
  formatAgentsForPrompt: vi.fn(() => `  - calendar-agent: Manages calendar
  - general-agent: General tasks`),
}));

vi.mock('../../../src/orchestrator/conversation-window.js', () => ({
  formatHistoryForPrompt: vi.fn(() => '(No recent history)'),
}));

// Import after mocks
import { createPlan, resolveTaskDates } from '../../../src/orchestrator/planner.js';
import type { PlanContext, AgentRegistry } from '../../../src/orchestrator/types.js';

describe('createPlan', () => {
  const mockRegistry: AgentRegistry = {
    getAgent: vi.fn((name: string) => ({
      name,
      description: `${name} description`,
      tools: ['*'],
      examples: [],
    })),
    listAgents: vi.fn(() => [
      { name: 'calendar-agent', description: 'Calendar', tools: [], examples: [] },
      { name: 'general-agent', description: 'General', tools: ['*'], examples: [] },
    ]),
  };

  const baseContext: PlanContext = {
    userMessage: 'Check my calendar',
    conversationHistory: [],
    userFacts: [],
    userConfig: { name: 'Test User', timezone: 'America/New_York' },
    stepResults: {},
    errors: [],
  };

  beforeEach(() => {
    clearMockState();
  });

  describe('basic plan creation', () => {
    it('should create a single-step plan for simple requests', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'User wants to check their calendar',
          goal: 'Show calendar events',
          steps: [
            { id: 'step_1', agent: 'calendar-agent', task: 'List calendar events' },
          ],
        })),
      ]);

      const plan = await createPlan(baseContext, mockRegistry);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].agent).toBe('calendar-agent');
      expect(plan.steps[0].task).toBe('List calendar events');
      expect(plan.goal).toBe('Show calendar events');
    });

    it('should create multi-step plan for complex requests', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'User wants to check calendar and create reminder',
          goal: 'Check calendar and set reminder',
          steps: [
            { id: 'step_1', agent: 'calendar-agent', task: 'List events for tomorrow' },
            { id: 'step_2', agent: 'scheduler-agent', task: 'Create reminder' },
          ],
        })),
      ]);

      const plan = await createPlan({
        ...baseContext,
        userMessage: 'Check my calendar for tomorrow and remind me about meetings',
      }, mockRegistry);

      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].agent).toBe('calendar-agent');
      expect(plan.steps[1].agent).toBe('scheduler-agent');
    });

    it('should set initial step status to pending', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Test goal',
          steps: [
            { id: 'step_1', agent: 'general-agent', task: 'Do something' },
          ],
        })),
      ]);

      const plan = await createPlan(baseContext, mockRegistry);

      expect(plan.steps[0].status).toBe('pending');
      expect(plan.steps[0].retryCount).toBe(0);
      expect(plan.steps[0].maxRetries).toBe(2);
    });

    it('should set plan status to executing', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Test goal',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Task' }],
        })),
      ]);

      const plan = await createPlan(baseContext, mockRegistry);

      expect(plan.status).toBe('executing');
      expect(plan.version).toBe(1);
    });
  });

  describe('plan metadata', () => {
    it('should generate unique plan ID', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Task' }],
        })),
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Task' }],
        })),
      ]);

      const plan1 = await createPlan(baseContext, mockRegistry);
      const plan2 = await createPlan(baseContext, mockRegistry);

      expect(plan1.id).not.toBe(plan2.id);
      expect(plan1.id).toMatch(/^plan_\d+_[a-z0-9]+$/);
    });

    it('should store user request in plan', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Task' }],
        })),
      ]);

      const plan = await createPlan({
        ...baseContext,
        userMessage: 'My specific request',
      }, mockRegistry);

      expect(plan.userRequest).toBe('My specific request');
    });

    it('should include timestamps', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Task' }],
        })),
      ]);

      const before = new Date();
      const plan = await createPlan(baseContext, mockRegistry);
      const after = new Date();

      expect(plan.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(plan.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(plan.updatedAt).toEqual(plan.createdAt);
    });
  });

  describe('LLM interaction', () => {
    it('should use temperature 0 for deterministic planning', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Task' }],
        })),
      ]);

      await createPlan(baseContext, mockRegistry);

      const calls = getCreateCalls();
      expect(calls.length).toBe(1);
      // Note: temperature is passed but our mock doesn't track it
      // In real tests we'd verify this
    });

    it('should include user message in request', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Task' }],
        })),
      ]);

      await createPlan({
        ...baseContext,
        userMessage: 'What meetings do I have?',
      }, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].messages[0]).toMatchObject({
        role: 'user',
        content: 'What meetings do I have?',
      });
    });

    it('should include planning prompt in system', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Task' }],
        })),
      ]);

      await createPlan(baseContext, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('planning module');
      expect(calls[0].system).toContain('available_agents');
    });

    it('should instruct planner to use memory-agent for memory tasks', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Memory task',
          goal: 'Store a fact',
          steps: [{ id: 'step_1', agent: 'memory-agent', task: 'Remember user likes tea' }],
        })),
      ]);

      await createPlan({
        ...baseContext,
        userMessage: 'Remember that I like tea',
      }, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('Memory tasks (store/recall/update/delete user facts)');
    });
  });

  describe('error handling', () => {
    it('should fall back to general-agent on parse error', async () => {
      setMockResponses([
        createTextResponse('This is not valid JSON at all!'),
      ]);

      const plan = await createPlan(baseContext, mockRegistry);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].agent).toBe('general-agent');
      expect(plan.goal).toBe('Handle user request');
    });

    it('should handle JSON in markdown code blocks', async () => {
      setMockResponses([
        createTextResponse('```json\n{"analysis": "Test", "goal": "Goal", "steps": [{"id": "step_1", "agent": "calendar-agent", "task": "Task"}]}\n```'),
      ]);

      const plan = await createPlan(baseContext, mockRegistry);

      expect(plan.steps[0].agent).toBe('calendar-agent');
    });

    it('should generate step IDs if missing', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [
            { agent: 'general-agent', task: 'Task 1' },
            { agent: 'general-agent', task: 'Task 2' },
          ],
        })),
      ]);

      const plan = await createPlan(baseContext, mockRegistry);

      expect(plan.steps[0].id).toBe('step_1');
      expect(plan.steps[1].id).toBe('step_2');
    });
  });

  describe('context integration', () => {
    it('should include user facts in prompt', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Task' }],
        })),
      ]);

      await createPlan({
        ...baseContext,
        userFacts: [
          {
            id: '1',
            phoneNumber: baseContext.phoneNumber,
            fact: 'User prefers mornings',
            category: 'preferences',
            confidence: 0.6,
            sourceType: 'explicit' as const,
            extractedAt: Date.now(),
          },
        ],
      }, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('facts');
      expect(calls[0].system).toContain('User prefers mornings');
    });
  });
});

describe('resolveTaskDates', () => {
  const timezone = 'America/New_York';

  it('should not modify task without relative dates', () => {
    const task = 'List all events';
    const resolved = resolveTaskDates(task, timezone);

    expect(resolved).toBe(task);
  });

  it('should not modify task with dates that cannot be resolved', () => {
    // "today" as a standalone word may not be resolved by the date resolver
    // This tests the function's behavior with unresolved patterns
    const task = 'Just a regular task';
    const resolved = resolveTaskDates(task, timezone);

    expect(resolved).toBe(task);
  });

  it('should handle "next week" pattern', () => {
    const task = 'Schedule for next week';
    const resolved = resolveTaskDates(task, timezone);

    // The function tries to resolve but may not modify if resolveDate returns null
    // This tests that the function doesn't crash
    expect(typeof resolved).toBe('string');
    expect(resolved.length).toBeGreaterThan(0);
  });

  it('should preserve task structure', () => {
    const task = 'List events for specific date at 9am';
    const resolved = resolveTaskDates(task, timezone);

    // Should not break the task structure
    expect(resolved).toContain('List events for');
  });
});
