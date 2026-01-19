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
import { classifyMessage, generateResponse } from '../../src/llm.js';
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
});
