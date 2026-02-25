import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies BEFORE importing the module under test
const mockCreatePlan = vi.fn();
const mockExecuteStep = vi.fn();
const mockShouldReplan = vi.fn();
const mockReplan = vi.fn();
const mockCanReplan = vi.fn();
const mockSynthesizeResponse = vi.fn();

vi.mock('../../../src/executor/registry.js', () => ({
  createAgentRegistry: vi.fn(() => ({
    getAgent: vi.fn(),
    listAgents: vi.fn(() => []),
  })),
}));

vi.mock('../../../src/orchestrator/planner.js', () => ({
  createPlan: (...args: unknown[]) => mockCreatePlan(...args),
}));

vi.mock('../../../src/orchestrator/executor.js', () => ({
  executeStep: (...args: unknown[]) => mockExecuteStep(...args),
  shouldReplan: (...args: unknown[]) => mockShouldReplan(...args),
}));

vi.mock('../../../src/orchestrator/replanner.js', () => ({
  replan: (...args: unknown[]) => mockReplan(...args),
  canReplan: (...args: unknown[]) => mockCanReplan(...args),
}));

vi.mock('../../../src/orchestrator/response-composer.js', () => ({
  synthesizeResponse: (...args: unknown[]) => mockSynthesizeResponse(...args),
}));

vi.mock('../../../src/tools/index.js', () => ({
  formatMapsLink: { tool: { name: 'format_maps_link' } },
  executeTool: vi.fn(),
}));

import { orchestrate } from '../../../src/orchestrator/orchestrate.js';

function createMockPlan(steps: Array<{ id: string; agent: string; task: string }>) {
  return {
    id: 'plan_test_123',
    userRequest: 'test request',
    goal: 'test goal',
    steps: steps.map(s => ({
      ...s,
      targetType: 'agent' as const,
      status: 'pending' as const,
      retryCount: 0,
      maxRetries: 2,
    })),
    status: 'executing' as const,
    context: {},
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const mockLogger = {
  log: vi.fn(),
  planEvent: vi.fn(),
  stepEvent: vi.fn(),
  llmRequest: vi.fn(),
  llmResponse: vi.fn(),
  section: vi.fn(),
  close: vi.fn(),
} as any;

describe('orchestrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldReplan.mockReturnValue(false);
    mockCanReplan.mockReturnValue(false);
  });

  it('should execute a single-step plan successfully', async () => {
    const plan = createMockPlan([{ id: 'step_1', agent: 'calendar-agent', task: 'List events' }]);
    mockCreatePlan.mockResolvedValue(plan);
    mockExecuteStep.mockResolvedValue({ success: true, output: 'Events found', toolCalls: [] });
    mockSynthesizeResponse.mockResolvedValue('Here are your events');

    const result = await orchestrate('Check my calendar', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(result.success).toBe(true);
    expect(result.response).toBe('Here are your events');
    expect(mockExecuteStep).toHaveBeenCalledTimes(1);
  });

  it('should execute multi-step plan sequentially', async () => {
    const plan = createMockPlan([
      { id: 'step_1', agent: 'calendar-agent', task: 'List events' },
      { id: 'step_2', agent: 'scheduler-agent', task: 'Create reminder' },
    ]);
    mockCreatePlan.mockResolvedValue(plan);
    mockExecuteStep.mockResolvedValue({ success: true, output: 'Done', toolCalls: [] });
    mockSynthesizeResponse.mockResolvedValue('All done');

    const result = await orchestrate('Check calendar and remind me', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(result.success).toBe(true);
    expect(mockExecuteStep).toHaveBeenCalledTimes(2);
  });

  it('should handle empty plan', async () => {
    const plan = createMockPlan([]);
    mockCreatePlan.mockResolvedValue(plan);
    mockSynthesizeResponse.mockResolvedValue('No actions needed');

    const result = await orchestrate('Hello', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(result.success).toBe(true);
    expect(result.response).toBe('No actions needed');
    expect(mockExecuteStep).not.toHaveBeenCalled();
  });

  it('should return error for empty user message', async () => {
    const result = await orchestrate('', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty');
    expect(mockCreatePlan).not.toHaveBeenCalled();
  });

  it('should return error for whitespace-only user message', async () => {
    const result = await orchestrate('   ', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty');
  });

  it('should retry failed step before replanning', async () => {
    const plan = createMockPlan([{ id: 'step_1', agent: 'calendar-agent', task: 'List events' }]);
    mockCreatePlan.mockResolvedValue(plan);
    mockExecuteStep
      .mockResolvedValueOnce({ success: false, output: null, error: 'API error' })
      .mockResolvedValueOnce({ success: true, output: 'Events found', toolCalls: [] });
    mockSynthesizeResponse.mockResolvedValue('Here are your events');

    const result = await orchestrate('Check my calendar', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(result.success).toBe(true);
    expect(mockExecuteStep).toHaveBeenCalledTimes(2);
  });

  it('should trigger replanning after max retries exhausted', async () => {
    const plan = createMockPlan([{ id: 'step_1', agent: 'calendar-agent', task: 'List events' }]);
    mockCreatePlan.mockResolvedValue(plan);
    mockExecuteStep.mockResolvedValue({ success: false, output: null, error: 'Persistent error' });
    mockCanReplan.mockReturnValue(true);

    const replanResult = createMockPlan([{ id: 'step_2', agent: 'memory-agent', task: 'Fallback' }]);
    mockReplan.mockResolvedValue(replanResult);
    mockExecuteStep.mockResolvedValueOnce({ success: false, output: null, error: 'err' })
      .mockResolvedValueOnce({ success: false, output: null, error: 'err' })
      .mockResolvedValueOnce({ success: false, output: null, error: 'err' })
      .mockResolvedValueOnce({ success: true, output: 'Fallback result', toolCalls: [] });
    mockSynthesizeResponse.mockResolvedValue('Handled via fallback');

    await orchestrate('Check my calendar', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(mockReplan).toHaveBeenCalled();
  });

  it('should fail when replanning not available', async () => {
    const plan = createMockPlan([{ id: 'step_1', agent: 'calendar-agent', task: 'List events' }]);
    mockCreatePlan.mockResolvedValue(plan);
    mockExecuteStep.mockResolvedValue({ success: false, output: null, error: 'Persistent error' });
    mockCanReplan.mockReturnValue(false);
    mockSynthesizeResponse.mockResolvedValue('Something went wrong');

    const result = await orchestrate('Check my calendar', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(result.success).toBe(false);
  });

  it('should catch and handle unexpected exceptions', async () => {
    mockCreatePlan.mockRejectedValue(new Error('Unexpected LLM failure'));

    const result = await orchestrate('Check my calendar', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(result.success).toBe(false);
    expect(result.response).toContain('unexpected error');
  });

  it('should trigger replan when agent signals needsReplan', async () => {
    const plan = createMockPlan([
      { id: 'step_1', agent: 'calendar-agent', task: 'List events' },
      { id: 'step_2', agent: 'scheduler-agent', task: 'Create reminder' },
    ]);
    mockCreatePlan.mockResolvedValue(plan);
    mockExecuteStep.mockResolvedValueOnce({ success: true, output: { needsReplan: true }, toolCalls: [] })
      .mockResolvedValueOnce({ success: true, output: 'Done', toolCalls: [] });
    mockShouldReplan.mockReturnValueOnce(true);
    mockCanReplan.mockReturnValue(true);

    const replanResult = createMockPlan([
      { id: 'step_1', agent: 'calendar-agent', task: 'List events' },
      { id: 'step_3', agent: 'memory-agent', task: 'Revised step' },
    ]);
    replanResult.steps[0].status = 'completed' as any;
    mockReplan.mockResolvedValue(replanResult);
    mockSynthesizeResponse.mockResolvedValue('Done');

    await orchestrate('Check my calendar', [], [], null, '+1234567890', 'whatsapp', mockLogger);

    expect(mockReplan).toHaveBeenCalled();
  });
});
