/**
 * Integration tests for the LLM classification module.
 *
 * Tests classifyMessage() with mocked Anthropic SDK.
 * Note: generateResponse() has been replaced by the orchestrator architecture.
 * See tests/unit/orchestrator/ and tests/unit/executor/ for those tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setMockResponses,
  createTextResponse,
  getCreateCalls,
  clearMockState,
} from '../mocks/anthropic.js';

// Import from the new location
import { classifyMessage } from '../../src/services/anthropic/index.js';

// Type for message history
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

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
