/**
 * Unit tests for UI agent executor.
 *
 * Tests that the UI agent:
 * 1. Uses the prompt from prompts.ts
 * 2. Replaces timeContext and userContext placeholders
 * 3. Calls executeWithTools with correct parameters
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../../../src/executor/tool-executor.js', () => ({
  executeWithTools: vi.fn(),
}));

vi.mock('../../../../src/services/anthropic/prompts/context.js', () => ({
  buildTimeContext: vi.fn(() => 'Friday, January 30, 2026 at 8:00 PM PST'),
}));

import { executor, capability } from '../../../../src/agents/ui/index.js';
import { executeWithTools } from '../../../../src/executor/tool-executor.js';
import { buildTimeContext } from '../../../../src/services/anthropic/prompts/context.js';
import type { AgentExecutionContext } from '../../../../src/executor/types.js';

const mockExecuteWithTools = vi.mocked(executeWithTools);
const mockBuildTimeContext = vi.mocked(buildTimeContext);

describe('UI agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteWithTools.mockResolvedValue({
      success: true,
      output: 'Created page: https://example.com/u/abc123',
    });
  });

  describe('capability', () => {
    it('should have correct name', () => {
      expect(capability.name).toBe('ui-agent');
    });

    it('should have generate_ui in tools list', () => {
      expect(capability.tools).toContain('generate_ui');
    });

    it('should have relevant examples', () => {
      expect(capability.examples).toContain('Create a shopping list I can check off');
      expect(capability.examples.length).toBeGreaterThan(0);
    });

    it('should have descriptive description', () => {
      expect(capability.description).toContain('interactive web pages');
    });
  });

  describe('executor', () => {
    const baseContext: AgentExecutionContext = {
      phoneNumber: '+1234567890',
      channel: 'sms',
      userConfig: null,
      previousStepResults: {},
    };

    const mockUserConfig = {
      phoneNumber: '+1234567890',
      name: 'Alex',
      timezone: 'America/Los_Angeles',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    it('should call executeWithTools with UI tools', async () => {
      await executor('Create a todo list', baseContext);

      expect(mockExecuteWithTools).toHaveBeenCalledWith(
        expect.any(String),
        'Create a todo list',
        ['generate_ui'],
        baseContext
      );
    });

    it('should include timeContext when userConfig is provided', async () => {
      const contextWithConfig: AgentExecutionContext = {
        ...baseContext,
        userConfig: mockUserConfig,
      };

      await executor('Create a timer', contextWithConfig);

      expect(mockBuildTimeContext).toHaveBeenCalledWith(contextWithConfig.userConfig);

      const systemPrompt = mockExecuteWithTools.mock.calls[0][0];
      expect(systemPrompt).toContain('Friday, January 30, 2026 at 8:00 PM PST');
    });

    it('should include userContext when user name is provided', async () => {
      const contextWithConfig: AgentExecutionContext = {
        ...baseContext,
        userConfig: mockUserConfig,
      };

      await executor('Create a form', contextWithConfig);

      const systemPrompt = mockExecuteWithTools.mock.calls[0][0];
      expect(systemPrompt).toContain('User: Alex');
    });

    it('should have empty timeContext when no userConfig', async () => {
      await executor('Create a list', baseContext);

      const systemPrompt = mockExecuteWithTools.mock.calls[0][0];
      // Should not contain unresolved placeholder
      expect(systemPrompt).not.toContain('{timeContext}');
    });

    it('should have empty userContext when no user name', async () => {
      await executor('Create a calculator', baseContext);

      const systemPrompt = mockExecuteWithTools.mock.calls[0][0];
      // Should not contain unresolved placeholder
      expect(systemPrompt).not.toContain('{userContext}');
    });

    it('should pass through the task correctly', async () => {
      const task = 'Build an interactive reminder manager with add, edit, and delete functionality';

      await executor(task, baseContext);

      expect(mockExecuteWithTools).toHaveBeenCalledWith(
        expect.any(String),
        task,
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('should return the result from executeWithTools', async () => {
      mockExecuteWithTools.mockResolvedValue({
        success: true,
        output: "Here's your page: https://example.com/u/xyz",
        toolCalls: [{ type: 'tool_use', id: 'tool_1', name: 'generate_ui', input: { html: '<div>test</div>' } }],
      });

      const result = await executor('Create something', baseContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('https://example.com/u/xyz');
    });

    describe('prompt content', () => {
      it('should include instructions about writing HTML code', async () => {
        await executor('Test', baseContext);

        const systemPrompt = mockExecuteWithTools.mock.calls[0][0];
        expect(systemPrompt).toContain('CRITICAL');
        expect(systemPrompt).toContain('complete, valid HTML code');
      });

      it('should include instructions about returning URL', async () => {
        await executor('Test', baseContext);

        const systemPrompt = mockExecuteWithTools.mock.calls[0][0];
        expect(systemPrompt).toContain('shortUrl');
        expect(systemPrompt).toContain('MUST include this URL');
      });

      it('should include persistence API documentation', async () => {
        await executor('Test', baseContext);

        const systemPrompt = mockExecuteWithTools.mock.calls[0][0];
        expect(systemPrompt).toContain('hermesLoadState');
        expect(systemPrompt).toContain('hermesSaveState');
      });
    });
  });
});
