/**
 * Unit tests for the tool executor module.
 *
 * Tests the core agentic loop that executes tasks with tool access.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setMockResponses,
  createTextResponse,
  createToolUseResponse,
  getCreateCalls,
  clearMockState,
} from '../../mocks/anthropic.js';

// Import after mocks are set up
import { executeWithTools, formatPreviousResults } from '../../../src/executor/tool-executor.js';
import type { AgentExecutionContext, StepResult } from '../../../src/executor/types.js';

// Mock the tools module
vi.mock('../../../src/tools/index.js', () => ({
  TOOLS: [
    { name: 'get_calendar_events', description: 'Get calendar events' },
    { name: 'create_calendar_event', description: 'Create calendar event' },
    { name: 'generate_ui', description: 'Generate UI page' },
  ],
  executeTool: vi.fn(async (name: string, input: Record<string, unknown>) => {
    // Return mock tool results based on tool name
    if (name === 'get_calendar_events') {
      return JSON.stringify({ success: true, events: [{ title: 'Meeting', time: '9am' }] });
    }
    if (name === 'create_calendar_event') {
      return JSON.stringify({ success: true, eventId: 'evt_123' });
    }
    if (name === 'generate_ui') {
      return JSON.stringify({ success: true, shortUrl: 'https://example.com/p/abc' });
    }
    return JSON.stringify({ success: false, error: 'Unknown tool' });
  }),
}));

describe('executeWithTools', () => {
  const baseContext: AgentExecutionContext = {
    phoneNumber: '+1234567890',
    channel: 'sms',
    userConfig: { name: 'Test User', timezone: 'America/New_York' },
    userFacts: [],
    previousStepResults: {},
  };

  beforeEach(() => {
    clearMockState();
  });

  describe('basic execution', () => {
    it('should return text response without tool use', async () => {
      setMockResponses([
        createTextResponse('Hello! How can I help you today?'),
      ]);

      const result = await executeWithTools(
        'You are a helpful assistant.',
        'Say hello',
        ['*'],
        baseContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello! How can I help you today?');
      expect(result.toolCalls).toBeUndefined();
    });

    it('should include task in the message', async () => {
      setMockResponses([
        createTextResponse('Done'),
      ]);

      await executeWithTools(
        'System prompt',
        'List my calendar events',
        ['*'],
        baseContext
      );

      const calls = getCreateCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].messages[0]).toMatchObject({
        role: 'user',
        content: expect.stringContaining('List my calendar events'),
      });
    });

    it('should pass system prompt to LLM', async () => {
      setMockResponses([
        createTextResponse('Done'),
      ]);

      await executeWithTools(
        'You are a calendar assistant.',
        'Task',
        ['*'],
        baseContext
      );

      const calls = getCreateCalls();
      expect(calls[0].system).toBe('You are a calendar assistant.');
    });
  });

  describe('tool execution', () => {
    it('should execute single tool call and return result', async () => {
      setMockResponses([
        createToolUseResponse('get_calendar_events', { date: '2026-01-30' }),
        createTextResponse('You have a meeting at 9am.'),
      ]);

      const result = await executeWithTools(
        'System prompt',
        'Check my calendar',
        ['get_calendar_events'],
        baseContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('You have a meeting at 9am.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].name).toBe('get_calendar_events');
    });

    it('should handle multiple tool calls in sequence', async () => {
      setMockResponses([
        createToolUseResponse('get_calendar_events', { date: '2026-01-30' }),
        createToolUseResponse('create_calendar_event', { title: 'New Meeting' }),
        createTextResponse('I checked your calendar and created the event.'),
      ]);

      const result = await executeWithTools(
        'System prompt',
        'Check calendar and create event',
        ['get_calendar_events', 'create_calendar_event'],
        baseContext
      );

      expect(result.success).toBe(true);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls![0].name).toBe('get_calendar_events');
      expect(result.toolCalls![1].name).toBe('create_calendar_event');

      // Should have made 3 API calls
      const calls = getCreateCalls();
      expect(calls.length).toBe(3);
    });

    it('should respect MAX_TOOL_LOOPS limit', async () => {
      // Set up 6+ tool use responses to exceed the limit (MAX_TOOL_LOOPS = 5)
      setMockResponses([
        createToolUseResponse('get_calendar_events', { date: '1' }),
        createToolUseResponse('get_calendar_events', { date: '2' }),
        createToolUseResponse('get_calendar_events', { date: '3' }),
        createToolUseResponse('get_calendar_events', { date: '4' }),
        createToolUseResponse('get_calendar_events', { date: '5' }),
        createToolUseResponse('get_calendar_events', { date: '6' }),
        createTextResponse('Finally done!'),
      ]);

      const result = await executeWithTools(
        'System prompt',
        'Keep checking calendar',
        ['get_calendar_events'],
        baseContext
      );

      // Should fail due to loop limit
      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool loop limit exceeded');
      expect(result.toolCalls).toHaveLength(5);
    });
  });

  describe('output parsing', () => {
    it('should parse JSON object output', async () => {
      setMockResponses([
        createTextResponse('{"status": "success", "count": 5}'),
      ]);

      const result = await executeWithTools(
        'System prompt',
        'Return JSON',
        ['*'],
        baseContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ status: 'success', count: 5 });
    });

    it('should parse JSON array output', async () => {
      setMockResponses([
        createTextResponse('[1, 2, 3]'),
      ]);

      const result = await executeWithTools(
        'System prompt',
        'Return array',
        ['*'],
        baseContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual([1, 2, 3]);
    });

    it('should keep invalid JSON as string', async () => {
      setMockResponses([
        createTextResponse('{invalid json}'),
      ]);

      const result = await executeWithTools(
        'System prompt',
        'Return text',
        ['*'],
        baseContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('{invalid json}');
    });

    it('should return empty string when no text block', async () => {
      setMockResponses([
        { content: [], stop_reason: 'end_turn' },
      ]);

      const result = await executeWithTools(
        'System prompt',
        'Task',
        ['*'],
        baseContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('');
    });
  });

  describe('context handling', () => {
    it('should include previous step results in message', async () => {
      const contextWithResults: AgentExecutionContext = {
        ...baseContext,
        previousStepResults: {
          step_1: {
            success: true,
            output: 'Found 3 events',
          },
        },
      };

      setMockResponses([
        createTextResponse('Done'),
      ]);

      await executeWithTools(
        'System prompt',
        'Continue task',
        ['*'],
        contextWithResults
      );

      const calls = getCreateCalls();
      const userMessage = calls[0].messages[0] as { content: string };
      expect(userMessage.content).toContain('<previous_results>');
      expect(userMessage.content).toContain('step_1');
      expect(userMessage.content).toContain('Found 3 events');
    });

    it('should handle empty previous results', async () => {
      setMockResponses([
        createTextResponse('Done'),
      ]);

      await executeWithTools(
        'System prompt',
        'Task',
        ['*'],
        baseContext
      );

      const calls = getCreateCalls();
      const userMessage = calls[0].messages[0] as { content: string };
      expect(userMessage.content).toContain('(No previous step results)');
    });

    it('should append user memory when facts are present', async () => {
      const contextWithFacts: AgentExecutionContext = {
        ...baseContext,
        userFacts: [
          {
            id: 'fact_1',
            phoneNumber: baseContext.phoneNumber,
            fact: 'Likes black coffee',
            extractedAt: Date.now(),
          },
        ],
      };

      setMockResponses([
        createTextResponse('Done'),
      ]);

      await executeWithTools(
        'System prompt',
        'Task',
        ['*'],
        contextWithFacts
      );

      const calls = getCreateCalls();
      expect(calls[0].system).toContain('<user_memory>');
      expect(calls[0].system).toContain('Likes black coffee');
    });

    it('should accept custom initial messages', async () => {
      setMockResponses([
        createTextResponse('Done'),
      ]);

      await executeWithTools(
        'System prompt',
        'Task',
        ['*'],
        baseContext,
        {
          initialMessages: [
            { role: 'user', content: 'Custom message 1' },
            { role: 'assistant', content: 'Response 1' },
            { role: 'user', content: 'Custom message 2' },
          ],
        }
      );

      const calls = getCreateCalls();
      expect(calls[0].messages).toHaveLength(3);
      expect(calls[0].messages[0]).toMatchObject({ role: 'user', content: 'Custom message 1' });
    });
  });

  describe('error handling', () => {
    it('should return error result on API failure', async () => {
      // Clear mock responses so default behavior throws
      setMockResponses([]);

      // Mock the create function to throw
      const { mockCreate } = await import('../../mocks/anthropic.js');
      mockCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const result = await executeWithTools(
        'System prompt',
        'Task',
        ['*'],
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
      expect(result.output).toBeNull();
    });

    it('should include partial tool calls on error', async () => {
      setMockResponses([
        createToolUseResponse('get_calendar_events', { date: '2026-01-30' }),
      ]);

      // After first tool call, mock throws
      const { mockCreate } = await import('../../mocks/anthropic.js');
      mockCreate
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'tool_1', name: 'get_calendar_events', input: {} }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 50 },
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await executeWithTools(
        'System prompt',
        'Task',
        ['get_calendar_events'],
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.toolCalls).toHaveLength(1);
    });
  });

  describe('token tracking', () => {
    it('should track token usage across calls', async () => {
      const { mockCreate } = await import('../../mocks/anthropic.js');
      mockCreate
        .mockResolvedValueOnce({
          content: [{ type: 'tool_use', id: 'tool_1', name: 'get_calendar_events', input: {} }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 50 },
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 75 },
        });

      const result = await executeWithTools(
        'System prompt',
        'Task',
        ['get_calendar_events'],
        baseContext
      );

      expect(result.tokenUsage).toEqual({
        input: 300,
        output: 125,
      });
    });
  });
});

describe('formatPreviousResults', () => {
  it('should return placeholder for empty results', () => {
    const formatted = formatPreviousResults({});
    expect(formatted).toBe('(No previous step results)');
  });

  it('should format string results', () => {
    const formatted = formatPreviousResults({
      step_1: 'Hello world',
    });

    expect(formatted).toContain('<step id="step_1">');
    expect(formatted).toContain('Hello world');
    expect(formatted).toContain('</step>');
  });

  it('should format object results as JSON', () => {
    const formatted = formatPreviousResults({
      step_1: { foo: 'bar', count: 5 },
    });

    expect(formatted).toContain('<step id="step_1">');
    expect(formatted).toContain('"foo": "bar"');
    expect(formatted).toContain('"count": 5');
  });

  it('should format multiple results', () => {
    const formatted = formatPreviousResults({
      step_1: 'First',
      step_2: 'Second',
    });

    expect(formatted).toContain('step_1');
    expect(formatted).toContain('step_2');
    expect(formatted).toContain('First');
    expect(formatted).toContain('Second');
  });
});
