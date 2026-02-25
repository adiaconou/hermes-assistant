import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockRouteToAgent = vi.fn();
const mockGetSkillsRegistry = vi.fn();

vi.mock('../../../src/executor/router.js', () => ({
  routeToAgent: (...args: unknown[]) => mockRouteToAgent(...args),
}));

vi.mock('../../../src/registry/skills.js', () => ({
  getSkillsRegistry: () => mockGetSkillsRegistry(),
}));

import { executeStep, shouldReplan, formatStepResult } from '../../../src/orchestrator/executor.js';
import type { PlanStep } from '../../../src/orchestrator/types.js';

function createMockStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'step_1',
    targetType: 'agent',
    agent: 'calendar-agent',
    task: 'List events',
    status: 'running',
    retryCount: 0,
    maxRetries: 2,
    ...overrides,
  };
}

const mockRegistry = {
  getAgent: vi.fn((name: string) => ({
    name,
    description: `${name} description`,
    tools: [],
    examples: [],
  })),
  listAgents: vi.fn(() => []),
};

const mockContext = {
  userMessage: 'test',
  conversationHistory: [],
  userFacts: [],
  userConfig: null,
  phoneNumber: '+1234567890',
  channel: 'whatsapp' as const,
  stepResults: {},
  errors: [],
};

const mockLogger = {
  log: vi.fn(),
  planEvent: vi.fn(),
  stepEvent: vi.fn(),
  llmRequest: vi.fn(),
  llmResponse: vi.fn(),
  section: vi.fn(),
  close: vi.fn(),
} as any;

describe('executeStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.getAgent.mockImplementation((name: string) => ({
      name,
      description: `${name} description`,
      tools: [],
      examples: [],
    }));
  });

  it('should route to correct agent and return result', async () => {
    mockRouteToAgent.mockResolvedValue({ success: true, output: 'Events found', toolCalls: [] });

    const result = await executeStep(createMockStep(), mockContext, mockRegistry, mockLogger);

    expect(result.success).toBe(true);
    expect(mockRouteToAgent).toHaveBeenCalledWith('calendar-agent', 'List events', expect.any(Object));
  });

  it('should return error for unknown agent', async () => {
    mockRegistry.getAgent.mockReturnValue(undefined);

    const result = await executeStep(createMockStep(), mockContext, mockRegistry, mockLogger);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown agent');
  });

  it('should handle agent throwing exception', async () => {
    mockRouteToAgent.mockRejectedValue(new Error('Agent crashed'));

    const result = await executeStep(createMockStep(), mockContext, mockRegistry, mockLogger);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent crashed');
  });

  it('should route to skill when targetType is skill', async () => {
    const mockSkillRegistry = {
      executeByName: vi.fn().mockResolvedValue({ success: true, output: 'Skill result' }),
    };
    mockGetSkillsRegistry.mockReturnValue(mockSkillRegistry);

    const step = createMockStep({ targetType: 'skill', agent: 'receipt-summarizer' });
    const result = await executeStep(step, mockContext, mockRegistry, mockLogger);

    expect(result.success).toBe(true);
    expect(mockSkillRegistry.executeByName).toHaveBeenCalledWith('receipt-summarizer', 'List events', expect.any(Object));
  });

  it('should normalize step result with missing output', async () => {
    mockRouteToAgent.mockResolvedValue({ success: true });

    const result = await executeStep(createMockStep(), mockContext, mockRegistry, mockLogger);

    expect(result.success).toBe(true);
    expect(result.output).toBeNull();
  });
});

describe('shouldReplan', () => {
  it('should return true when output.needsReplan is true', () => {
    expect(shouldReplan({ success: true, output: { needsReplan: true } }, 0, 2)).toBe(true);
  });

  it('should return true when output.isEmpty with remaining steps', () => {
    expect(shouldReplan({ success: true, output: { isEmpty: true } }, 0, 2)).toBe(true);
  });

  it('should return false when output.isEmpty on last step', () => {
    expect(shouldReplan({ success: true, output: { isEmpty: true } }, 1, 2)).toBe(false);
  });

  it('should return true when step failed with remaining steps', () => {
    expect(shouldReplan({ success: false, output: null, error: 'err' }, 0, 2)).toBe(true);
  });

  it('should return false when step failed on last step', () => {
    expect(shouldReplan({ success: false, output: null, error: 'err' }, 1, 2)).toBe(false);
  });

  it('should return false for successful result without replan signal', () => {
    expect(shouldReplan({ success: true, output: 'data' }, 0, 2)).toBe(false);
  });
});

describe('formatStepResult', () => {
  it('should format successful result', () => {
    const step = createMockStep();
    const result = formatStepResult(step, { success: true, output: 'data' });
    expect(result).toContain('SUCCESS');
    expect(result).toContain('calendar-agent');
  });

  it('should format failed result with error', () => {
    const step = createMockStep();
    const result = formatStepResult(step, { success: false, output: null, error: 'API failed' });
    expect(result).toContain('FAILED');
    expect(result).toContain('API failed');
  });

  it('should include tool names', () => {
    const step = createMockStep();
    const result = formatStepResult(step, {
      success: true,
      output: 'data',
      toolCalls: [{ type: 'tool_use', id: 't1', name: 'list_events', input: {} }],
    });
    expect(result).toContain('list_events');
  });
});
