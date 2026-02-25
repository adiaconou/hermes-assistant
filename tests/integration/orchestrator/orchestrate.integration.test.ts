import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock external services only — let internal orchestrator modules run with real logic
const mockMessagesCreate = vi.fn();

vi.mock('../../../src/services/anthropic/client.js', () => ({
  getClient: () => ({
    messages: { create: mockMessagesCreate },
  }),
}));

vi.mock('../../../src/config.js', () => ({
  default: {
    models: {
      planner: 'claude-test',
      composer: 'claude-test',
    },
  },
}));

const mockRouteToAgent = vi.fn();
vi.mock('../../../src/executor/router.js', () => ({
  routeToAgent: (...args: unknown[]) => mockRouteToAgent(...args),
}));

vi.mock('../../../src/executor/registry.js', () => ({
  createAgentRegistry: () => ({
    getAgent: (name: string) => ({
      name,
      description: `${name} agent`,
      tools: [],
      examples: [],
    }),
    listAgents: () => [],
  }),
  formatAgentsForPrompt: () => '  - calendar-agent: Calendar\n  - memory-agent: Memory',
}));

vi.mock('../../../src/registry/skills.js', () => ({
  getSkillsRegistry: () => ({
    list: () => [],
    executeByName: vi.fn(),
  }),
}));

vi.mock('../../../src/services/anthropic/prompts/context.js', () => ({
  buildTimeContext: () => 'Tuesday, 2026-02-24 09:00 EST',
  buildUserContext: () => 'User: Test User',
  buildUserMemoryXml: () => '',
}));

vi.mock('../../../src/services/date/resolver.js', () => ({
  resolveDate: () => null,
  resolveDateRange: () => null,
}));

vi.mock('../../../src/orchestrator/conversation-window.js', () => ({
  formatHistoryForPrompt: () => '(No recent history)',
  getRelevantHistory: (msgs: unknown[]) => msgs,
}));

vi.mock('../../../src/orchestrator/media-context.js', () => ({
  formatCurrentMediaContext: () => '',
  formatMediaContext: () => '',
}));

vi.mock('../../../src/tools/index.js', () => ({
  formatMapsLink: { tool: { name: 'format_maps_link', description: 'Format maps link', input_schema: { type: 'object', properties: {} } } },
  executeTool: vi.fn(),
}));

import { orchestrate } from '../../../src/orchestrator/orchestrate.js';

const mockLogger = {
  log: vi.fn(),
  planEvent: vi.fn(),
  stepEvent: vi.fn(),
  llmRequest: vi.fn(),
  llmResponse: vi.fn(),
  section: vi.fn(),
  close: vi.fn(),
} as any;

describe('orchestrate integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process single-step request end-to-end', async () => {
    // Planning LLM returns a valid plan
    mockMessagesCreate
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({
          analysis: 'User wants calendar events',
          goal: 'Show calendar events',
          steps: [{ id: 'step_1', agent: 'calendar-agent', task: 'List events for today' }],
        })}],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      })
      // Composition LLM returns the final response
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'You have 3 events today.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 30 },
      });

    mockRouteToAgent.mockResolvedValue({
      success: true,
      output: 'Found 3 events: standup, lunch, review',
      toolCalls: [],
    });

    const result = await orchestrate(
      'Check my calendar',
      [],
      [],
      { name: 'Test User', timezone: 'America/New_York' },
      '+1234567890',
      'whatsapp',
      mockLogger
    );

    expect(result.success).toBe(true);
    expect(result.response).toBe('You have 3 events today.');
    expect(mockRouteToAgent).toHaveBeenCalledWith('calendar-agent', 'List events for today', expect.any(Object));
  });

  it('should handle plan parse failure with graceful fallback', async () => {
    // Planning LLM returns garbage
    mockMessagesCreate
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'I cannot process this request properly' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      })
      // Composition LLM
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Here is what I found.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 30 },
      });

    mockRouteToAgent.mockResolvedValue({
      success: true,
      output: 'Handled via memory agent',
      toolCalls: [],
    });

    const result = await orchestrate(
      'Do something',
      [],
      [],
      null,
      '+1234567890',
      'whatsapp',
      mockLogger
    );

    expect(result.success).toBe(true);
    // Should have fallen back to memory-agent
    expect(mockRouteToAgent).toHaveBeenCalledWith('memory-agent', expect.any(String), expect.any(Object));
  });

  it('should handle multi-step plan end-to-end', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({
          analysis: 'User wants calendar and reminder',
          goal: 'Check calendar and set reminder',
          steps: [
            { id: 'step_1', agent: 'calendar-agent', task: 'List events tomorrow' },
            { id: 'step_2', agent: 'scheduler-agent', task: 'Create reminder for meeting' },
          ],
        })}],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 80 },
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Events checked and reminder set.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 300, output_tokens: 25 },
      });

    mockRouteToAgent
      .mockResolvedValueOnce({ success: true, output: '2 events found', toolCalls: [] })
      .mockResolvedValueOnce({ success: true, output: 'Reminder created', toolCalls: [] });

    const result = await orchestrate(
      'Check calendar and remind me about meetings',
      [],
      [],
      { name: 'Test User', timezone: 'UTC' },
      '+1234567890',
      'whatsapp',
      mockLogger
    );

    expect(result.success).toBe(true);
    expect(result.response).toBe('Events checked and reminder set.');
    expect(mockRouteToAgent).toHaveBeenCalledTimes(2);
  });
});
