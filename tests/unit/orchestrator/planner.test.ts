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
  - memory-agent: Memory tasks`),
}));

vi.mock('../../../src/orchestrator/conversation-window.js', () => ({
  formatHistoryForPrompt: vi.fn(() => '(No recent history)'),
}));

vi.mock('../../../src/orchestrator/media-context.js', () => ({
  formatCurrentMediaContext: vi.fn((summaries: unknown[]) => {
    if (!summaries || (summaries as unknown[]).length === 0) return '';
    return '<current_media>\nMocked current media block\n</current_media>';
  }),
}));

// Import after mocks
import { createPlan, resolveTaskDates } from '../../../src/orchestrator/planner.js';
import type { PlanContext, AgentRegistry } from '../../../src/orchestrator/types.js';

describe('createPlan', () => {
  const mockRegistry: AgentRegistry = {
    getAgent: vi.fn((name: string) => ({
      name,
      description: `${name} description`,
      tools: [],
      examples: [],
    })),
    listAgents: vi.fn(() => [
      { name: 'calendar-agent', description: 'Calendar', tools: [], examples: [] },
      { name: 'memory-agent', description: 'Memory', tools: [], examples: [] },
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
            { id: 'step_1', agent: 'calendar-agent', task: 'Do something' },
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
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
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
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
        })),
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
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
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
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
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
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
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
        })),
      ]);

      await createPlan(baseContext, mockRegistry);

      const calls = getCreateCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].temperature).toBe(0);
      expect(calls[0].max_tokens).toBe(1024);
    });

    it('should include user message in request', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
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
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
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

    it('should instruct planner to prefer specialized agents for single-domain tasks', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Calendar request',
          goal: 'Show calendar events',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'List events today' }],
        })),
      ]);

      await createPlan({
        ...baseContext,
        userMessage: 'What is on my calendar today?',
      }, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('use the matching specialized agent');
      expect(calls[0].system).toContain('Greetings and small talk are already handled');
    });
  });

  describe('error handling', () => {
    it('should fall back to memory-agent on parse error', async () => {
      setMockResponses([
        createTextResponse('This is not valid JSON at all!'),
      ]);

      const plan = await createPlan(baseContext, mockRegistry);
      const calls = getCreateCalls();

      expect(calls).toHaveLength(1);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].agent).toBe('memory-agent');
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
            { agent: 'calendar-agent', task: 'Task 1' },
            { agent: 'calendar-agent', task: 'Task 2' },
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
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
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

  describe('media-first planning', () => {
    it('should include current media block when summaries are provided', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'User sent a receipt image',
          goal: 'Process receipt',
          steps: [{ id: 'step_1', agent: 'drive-agent', task: 'Extract receipt data' }],
        })),
      ]);

      await createPlan({
        ...baseContext,
        userMessage: 'Log this expense\n\n[User sent an image]',
        currentMediaSummaries: [{
          attachment_index: 0,
          mime_type: 'image/jpeg',
          category: 'receipt',
          summary: 'A Whole Foods receipt totaling $47.23.',
        }],
      }, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('<current_media>');
    });

    it('should not include current media XML block when no summaries', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
        })),
      ]);

      await createPlan(baseContext, mockRegistry);

      const calls = getCreateCalls();
      // The rules text references <current_media>, but the actual XML block should not be present
      expect(calls[0].system).not.toContain('Mocked current media block');
    });

    it('should include deictic resolution rule in prompt', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
        })),
      ]);

      await createPlan(baseContext, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('resolve "this/that/it"');
      expect(calls[0].system).toContain('before conversation history');
    });

    it('should include intent priority rule in prompt', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
        })),
      ]);

      await createPlan(baseContext, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('Intent priority');
      expect(calls[0].system).toContain('explicit user text first');
    });

    it('should include media ambiguity clarification rule in prompt', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
        })),
      ]);

      await createPlan(baseContext, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('media-only or still ambiguous');
      expect(calls[0].system).toContain('memory-agent step');
    });

    it('should replace {mediaContext} placeholder with context.mediaContext', async () => {
      const mediaContextBlock = '<media_context>\nPreviously analyzed images here\n</media_context>';

      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'User references a previous image',
          goal: 'Answer about image',
          steps: [{ id: 'step_1', agent: 'drive-agent', task: 'Look up image analysis' }],
        })),
      ]);

      await createPlan({
        ...baseContext,
        userMessage: 'What was in that receipt?',
        mediaContext: mediaContextBlock,
      }, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('Previously analyzed images here');
      expect(calls[0].system).toContain('<media_context>');
      // Placeholder should be replaced, not present literally
      expect(calls[0].system).not.toContain('{mediaContext}');
    });

    it('should replace {mediaContext} with empty string when no mediaContext', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
        })),
      ]);

      await createPlan(baseContext, mockRegistry);

      const calls = getCreateCalls();
      // Should not contain the literal placeholder
      expect(calls[0].system).not.toContain('{mediaContext}');
    });

    it('should include media_context routing rule (rule 16) in prompt', async () => {
      setMockResponses([
        createTextResponse(JSON.stringify({
          analysis: 'Test',
          goal: 'Goal',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'Task' }],
        })),
      ]);

      await createPlan(baseContext, mockRegistry);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('media_context');
      expect(calls[0].system).toContain('previously analyzed images');
      expect(calls[0].system).toContain('drive-agent');
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

    expect(resolved).not.toBe(task);
    expect(resolved).toContain('(next week)');
    expect(resolved).toMatch(/\d{4}-\d{2}-\d{2}\s+to\s+\d{4}-\d{2}-\d{2}/);
  });

  it('should preserve task structure', () => {
    const task = 'List events for specific date at 9am';
    const resolved = resolveTaskDates(task, timezone);

    // Should not break the task structure
    expect(resolved).toContain('List events for');
  });
});
