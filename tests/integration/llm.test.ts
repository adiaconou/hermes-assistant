/**
 * Integration tests for the LLM module.
 *
 * Tests classifyMessage() and generateResponse() with mocked Anthropic SDK.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setMockResponses,
  createTextResponse,
  createToolUseResponse,
  getCreateCalls,
  clearMockState,
} from '../mocks/anthropic.js';

// Import after mocks are set up
import { classifyMessage, generateResponse } from '../../src/llm/index.js';
import type { Message } from '../../src/conversation.js';

describe('classifyMessage', () => {
  beforeEach(() => {
    clearMockState();
  });

  it('should return needsAsyncWork=false for simple questions', async () => {
    setMockResponses([
      createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Hello! How can I help?"}'),
    ]);

    const result = await classifyMessage('Hi', []);

    expect(result.needsAsyncWork).toBe(false);
    expect(result.immediateResponse).toBe('Hello! How can I help?');
  });

  it('should return needsAsyncWork=true for complex requests', async () => {
    setMockResponses([
      createTextResponse('{"needsAsyncWork": true, "immediateResponse": "Let me create that list for you!"}'),
    ]);

    const result = await classifyMessage('Create a grocery list for making pasta', []);

    expect(result.needsAsyncWork).toBe(true);
    expect(result.immediateResponse).toContain('list');
  });

  it('should include conversation history in request', async () => {
    setMockResponses([
      createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Got it!"}'),
    ]);

    const history: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    await classifyMessage('Thanks', history);

    const calls = getCreateCalls();
    expect(calls.length).toBe(1);
    // Should include recent history + current message
    expect(calls[0].messages.length).toBe(3);
  });

  it('should default to async work on parse error', async () => {
    setMockResponses([
      createTextResponse('This is not valid JSON'),
    ]);

    const result = await classifyMessage('Test', []);

    expect(result.needsAsyncWork).toBe(true);
    expect(result.immediateResponse).toBeDefined();
  });

  it('should use fast model for classification', async () => {
    setMockResponses([
      createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Test"}'),
    ]);

    await classifyMessage('Test', []);

    const calls = getCreateCalls();
    expect(calls.length).toBe(1);
    // Classification should use a fast model
    expect(calls[0].model).toContain('claude');
  });
});

describe('generateResponse', () => {
  beforeEach(() => {
    clearMockState();
  });

  it('should return text response for simple messages', async () => {
    setMockResponses([
      createTextResponse('Hello! I am your assistant. How can I help you today?'),
    ]);

    const response = await generateResponse('Hello', []);

    expect(response).toBe('Hello! I am your assistant. How can I help you today?');
  });

  it('should handle tool use responses', async () => {
    // First response: tool use
    // Second response: final text after tool result
    setMockResponses([
      createToolUseResponse('generate_ui', {
        title: 'Test Page',
        html: '<div>Test</div>',
      }),
      createTextResponse('I created a page for you! Here is the link: http://localhost:3000/p/abc123'),
    ]);

    const response = await generateResponse('Create a test page', []);

    expect(response).toContain('page');

    // Should have made 2 API calls (initial + after tool result)
    const calls = getCreateCalls();
    expect(calls.length).toBe(2);
  });

  it('should include conversation history', async () => {
    setMockResponses([
      createTextResponse('Based on our previous conversation, here is my response.'),
    ]);

    const history: Message[] = [
      { role: 'user', content: 'My name is John' },
      { role: 'assistant', content: 'Nice to meet you, John!' },
    ];

    await generateResponse('What is my name?', history);

    const calls = getCreateCalls();
    expect(calls.length).toBe(1);
    // Should include history + current message
    expect(calls[0].messages.length).toBe(3);
  });

  it('should handle multiple tool use loops', async () => {
    setMockResponses([
      // First tool use
      createToolUseResponse('generate_ui', { title: 'Page 1', html: '<div>1</div>' }),
      // Second tool use (after first result)
      createToolUseResponse('generate_ui', { title: 'Page 2', html: '<div>2</div>' }),
      // Final response
      createTextResponse('I created both pages for you!'),
    ]);

    const response = await generateResponse('Create two pages', []);

    expect(response).toBe('I created both pages for you!');

    // Should have made 3 API calls
    const calls = getCreateCalls();
    expect(calls.length).toBe(3);
  });

  it('should return fallback message if no text block', async () => {
    setMockResponses([
      {
        content: [], // Empty content
        stop_reason: 'end_turn',
      },
    ]);

    const response = await generateResponse('Test', []);

    expect(response).toBe('I could not generate a response.');
  });

  it('should use full model for response generation', async () => {
    setMockResponses([
      createTextResponse('Test response'),
    ]);

    await generateResponse('Test', []);

    const calls = getCreateCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].model).toContain('claude');
  });

  it('should include system prompt with UI instructions', async () => {
    setMockResponses([
      createTextResponse('Test response'),
    ]);

    await generateResponse('Test', []);

    const calls = getCreateCalls();
    expect(calls[0].system).toContain('SMS assistant');
    expect(calls[0].system).toContain('generate_ui');
  });

  it('should accept options parameter with custom system prompt', async () => {
    setMockResponses([
      createTextResponse('Custom prompt response'),
    ]);

    await generateResponse('Test', [], undefined, null, {
      systemPrompt: 'You are a custom assistant for testing.',
    });

    const calls = getCreateCalls();
    expect(calls[0].system).toContain('custom assistant for testing');
  });

  it('should accept options parameter with channel', async () => {
    setMockResponses([
      createTextResponse('WhatsApp response'),
    ]);

    // This verifies the options parameter is correctly typed and passed
    // The channel option is used by handleToolCall for scheduled job creation
    await generateResponse('Test', [], '+1234567890', null, {
      channel: 'whatsapp',
    });

    const calls = getCreateCalls();
    expect(calls.length).toBe(1);
  });
});

describe('generateResponse with code review', () => {
  beforeEach(() => {
    clearMockState();
  });

  it('should pass generated code back to LLM in tool result', async () => {
    setMockResponses([
      createToolUseResponse('generate_ui', {
        title: 'Test Tabs',
        html: '<button class="tab">Tab 1</button>',
        css: '.tab { color: blue; }',
        js: 'function showTab() { }',
      }),
      createTextResponse('I created a tabbed page for you!'),
    ]);

    await generateResponse('Create a page with tabs', []);

    const calls = getCreateCalls();
    expect(calls.length).toBe(2);

    // The second call should include tool results with generated code
    const secondCallMessages = calls[1].messages as Array<{
      role: string;
      content: unknown;
    }>;

    // Find the user message with tool results (it's an array of tool_result blocks)
    const toolResultMessage = secondCallMessages.find(
      (m) => m.role === 'user' && Array.isArray(m.content)
    );

    expect(toolResultMessage).toBeDefined();

    // Parse the tool result content
    const toolResults = toolResultMessage!.content as Array<{
      type: string;
      tool_use_id: string;
      content: string;
    }>;
    const resultContent = JSON.parse(toolResults[0].content);

    expect(resultContent.success).toBe(true);
    expect(resultContent.generatedCode).toBeDefined();
    expect(resultContent.generatedCode.html).toContain('tab');
    expect(resultContent.generatedCode.css).toContain('.tab');
    expect(resultContent.generatedCode.js).toContain('showTab');
  });

  it('should include empty strings for optional css/js when not provided', async () => {
    setMockResponses([
      createToolUseResponse('generate_ui', {
        title: 'Simple Page',
        html: '<div>Hello</div>',
        // No css or js provided
      }),
      createTextResponse('Created a simple page!'),
    ]);

    await generateResponse('Create a simple page', []);

    const calls = getCreateCalls();
    const secondCallMessages = calls[1].messages as Array<{
      role: string;
      content: unknown;
    }>;

    const toolResultMessage = secondCallMessages.find(
      (m) => m.role === 'user' && Array.isArray(m.content)
    );

    const toolResults = toolResultMessage!.content as Array<{
      type: string;
      tool_use_id: string;
      content: string;
    }>;
    const resultContent = JSON.parse(toolResults[0].content);

    expect(resultContent.generatedCode.css).toBe('');
    expect(resultContent.generatedCode.js).toBe('');
  });

  it('should allow LLM to regenerate UI after reviewing code', async () => {
    // First response: LLM generates UI
    // Second response: LLM notices issue, regenerates
    // Third response: LLM satisfied, returns URL
    setMockResponses([
      createToolUseResponse('generate_ui', {
        title: 'Buggy Tabs',
        html: '<button class="tab">Tab 1</button>',
        js: 'function showTab() { }', // Bug: not connected to button
      }),
      createToolUseResponse('generate_ui', {
        title: 'Fixed Tabs',
        html: '<button class="tab" onclick="showTab(\'tab1\')">Tab 1</button>',
        js: 'function showTab(id) { document.getElementById(id).classList.add("active"); }',
      }),
      createTextResponse('I created a tabbed page: https://example.com/u/fixed'),
    ]);

    const response = await generateResponse('Create a page with tabs', []);

    expect(response).toContain('tabbed page');

    // Should have made 3 API calls (initial + 2 tool results)
    const calls = getCreateCalls();
    expect(calls.length).toBe(3);
  });

  it('should respect MAX_TOOL_LOOPS even with regeneration', async () => {
    // Set up 6+ tool use responses to exceed the limit (MAX_TOOL_LOOPS = 5)
    setMockResponses([
      createToolUseResponse('generate_ui', { title: 'V1', html: '<div>1</div>' }),
      createToolUseResponse('generate_ui', { title: 'V2', html: '<div>2</div>' }),
      createToolUseResponse('generate_ui', { title: 'V3', html: '<div>3</div>' }),
      createToolUseResponse('generate_ui', { title: 'V4', html: '<div>4</div>' }),
      createToolUseResponse('generate_ui', { title: 'V5', html: '<div>5</div>' }),
      createToolUseResponse('generate_ui', { title: 'V6', html: '<div>6</div>' }),
      createTextResponse('Finally done!'),
    ]);

    await generateResponse('Create a page', []);

    // Should stop at MAX_TOOL_LOOPS (5), not continue to 6
    // 1 initial call + 5 loop iterations = 6 total calls max
    const calls = getCreateCalls();
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it('should include generatedCode instructions in system prompt', async () => {
    setMockResponses([
      createTextResponse('Test response'),
    ]);

    await generateResponse('Test', []);

    const calls = getCreateCalls();
    expect(calls[0].system).toContain('generatedCode');
    expect(calls[0].system).toContain('event handlers');
  });
});
