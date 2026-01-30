/**
 * Unit tests for the response composer module.
 *
 * Tests final response synthesis from execution results.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setMockResponses,
  createTextResponse,
  clearMockState,
  getCreateCalls,
} from '../../mocks/anthropic.js';

// Import after mock is loaded
import { synthesizeResponse } from '../../../src/orchestrator/response-composer.js';
import type { ExecutionPlan, PlanContext } from '../../../src/orchestrator/types.js';

describe('synthesizeResponse', () => {
  const createBasePlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
    id: 'plan_123',
    userRequest: 'Check my calendar',
    goal: 'Show calendar events',
    steps: [
      {
        id: 'step_1',
        agent: 'calendar-agent',
        task: 'List events',
        status: 'completed',
        result: { success: true, output: 'Found 3 events' },
        retryCount: 0,
        maxRetries: 2,
      },
    ],
    status: 'completed',
    context: {
      userMessage: 'Check my calendar',
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

  const createBaseContext = (overrides: Partial<PlanContext> = {}): PlanContext => ({
    userMessage: 'Check my calendar',
    conversationHistory: [],
    userFacts: [],
    userConfig: null,
    phoneNumber: '+1234567890',
    channel: 'sms',
    stepResults: {
      step_1: { success: true, output: 'Found 3 events for today' },
    },
    errors: [],
    ...overrides,
  });

  beforeEach(() => {
    clearMockState();
  });

  describe('successful synthesis', () => {
    it('should generate response from LLM', async () => {
      setMockResponses([
        createTextResponse('You have 3 events today!'),
      ]);

      const context = createBaseContext();
      const plan = createBasePlan();

      const response = await synthesizeResponse(context, plan);

      expect(response).toBe('You have 3 events today!');
    });

    it('should include user request in prompt', async () => {
      setMockResponses([
        createTextResponse('Response'),
      ]);

      const context = createBaseContext({ userMessage: 'What meetings do I have?' });
      const plan = createBasePlan({ userRequest: 'What meetings do I have?' });

      await synthesizeResponse(context, plan);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('What meetings do I have?');
    });

    it('should include goal in prompt', async () => {
      setMockResponses([
        createTextResponse('Response'),
      ]);

      const context = createBaseContext();
      const plan = createBasePlan({ goal: 'Display all calendar events' });

      await synthesizeResponse(context, plan);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('Display all calendar events');
    });

    it('should include step results in prompt', async () => {
      setMockResponses([
        createTextResponse('Response'),
      ]);

      const context = createBaseContext({
        stepResults: {
          step_1: { success: true, output: 'Meeting at 2pm with John' },
        },
      });
      const plan = createBasePlan();

      await synthesizeResponse(context, plan);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('Meeting at 2pm with John');
      expect(calls[0].system).toContain('SUCCESS');
    });
  });

  describe('with user name', () => {
    it('should include user name in system prompt when available', async () => {
      setMockResponses([
        createTextResponse('Hi Sarah! You have 3 events.'),
      ]);

      const context = createBaseContext({
        userConfig: { name: 'Sarah', timezone: 'America/New_York' },
      });
      const plan = createBasePlan();

      await synthesizeResponse(context, plan);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('Sarah');
    });
  });

  describe('failure handling', () => {
    it('should include timeout context when timeout failure', async () => {
      setMockResponses([
        createTextResponse('Sorry, the request timed out. Some actions completed.'),
      ]);

      const context = createBaseContext();
      const plan = createBasePlan();

      const response = await synthesizeResponse(context, plan, 'timeout');

      expect(response).toContain('timed out');

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('timed out');
    });

    it('should include failed step errors when step_failed', async () => {
      setMockResponses([
        createTextResponse('Could not complete all tasks.'),
      ]);

      const context = createBaseContext();
      const plan = createBasePlan({
        steps: [
          {
            id: 'step_1',
            agent: 'calendar-agent',
            task: 'List events',
            status: 'completed',
            result: { success: true, output: 'Found events' },
            retryCount: 0,
            maxRetries: 2,
          },
          {
            id: 'step_2',
            agent: 'email-agent',
            task: 'Send email',
            status: 'failed',
            result: { success: false, error: 'Email service unavailable' },
            retryCount: 2,
            maxRetries: 2,
          },
        ],
      });

      await synthesizeResponse(context, plan, 'step_failed');

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('Email service unavailable');
      expect(calls[0].system).toContain('failed');
    });
  });

  describe('empty results', () => {
    it('should handle no step results', async () => {
      setMockResponses([
        createTextResponse('I completed your request.'),
      ]);

      const context = createBaseContext({ stepResults: {} });
      const plan = createBasePlan();

      await synthesizeResponse(context, plan);

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('No step results');
    });
  });

  describe('result truncation', () => {
    it('should truncate long outputs in prompt', async () => {
      setMockResponses([
        createTextResponse('Response'),
      ]);

      const longOutput = 'A'.repeat(1000);
      const context = createBaseContext({
        stepResults: {
          step_1: { success: true, output: longOutput },
        },
      });
      const plan = createBasePlan();

      await synthesizeResponse(context, plan);

      const calls = getCreateCalls();
      // Output should be truncated to 500 chars
      const outputInPrompt = calls[0].system.match(/Output: (A+)/);
      expect(outputInPrompt).toBeTruthy();
      expect(outputInPrompt![1].length).toBeLessThanOrEqual(500);
    });
  });

  describe('fallback responses', () => {
    it('should return default message if no text block in response', async () => {
      // Mock response with no text blocks
      setMockResponses([
        { content: [] }, // No text blocks
      ]);

      const context = createBaseContext();
      const plan = createBasePlan();

      const response = await synthesizeResponse(context, plan);

      expect(response).toBe('I completed your request.');
    });
  });

  describe('error handling', () => {
    it('should return fallback on API error with failure reason', async () => {
      // Make the mock throw
      setMockResponses([]);
      // The mock will throw when no responses are available

      const context = createBaseContext();
      const plan = createBasePlan();

      const response = await synthesizeResponse(context, plan, 'timeout');

      expect(response).toContain('issues');
    });

    it('should extract shortUrl from results on API error', async () => {
      setMockResponses([]); // Will cause error

      const context = createBaseContext({
        stepResults: {
          step_1: { success: true, output: { shortUrl: 'https://short.url/abc' } },
        },
      });
      const plan = createBasePlan();

      const response = await synthesizeResponse(context, plan);

      expect(response).toContain('https://short.url/abc');
    });

    it('should extract message from results on API error', async () => {
      setMockResponses([]); // Will cause error

      const context = createBaseContext({
        stepResults: {
          step_1: { success: true, output: { message: 'Event created successfully' } },
        },
      });
      const plan = createBasePlan();

      const response = await synthesizeResponse(context, plan);

      expect(response).toContain('Event created successfully');
    });

    it('should return generic fallback when no useful output', async () => {
      setMockResponses([]); // Will cause error

      const context = createBaseContext({
        stepResults: {
          step_1: { success: false, error: 'Failed' },
        },
      });
      const plan = createBasePlan();

      const response = await synthesizeResponse(context, plan);

      expect(response).toContain('Done');
    });
  });
});
