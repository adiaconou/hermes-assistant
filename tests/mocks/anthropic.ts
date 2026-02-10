/**
 * Mock for @anthropic-ai/sdk module.
 *
 * Provides configurable mock responses for testing LLM interactions
 * without making real API calls.
 */

import { vi } from 'vitest';

/**
 * Text block response from Anthropic API.
 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * Tool use block response from Anthropic API.
 */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Content block can be text or tool_use.
 */
export type ContentBlock = TextBlock | ToolUseBlock;

/**
 * Mock response structure matching Anthropic API response.
 */
export interface MockResponse {
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use';
}

// Queue of mock responses to return
let mockResponses: MockResponse[] = [];

export interface CreateCall {
  model: string;
  messages: unknown[];
  system?: string;
  max_tokens?: number;
  temperature?: number;
  tools?: unknown[];
}

// Call history for assertions
let createCalls: CreateCall[] = [];

/**
 * Set the mock responses to return from messages.create().
 * Responses are consumed in order (first response is returned first).
 * If the queue is empty, a default text response is returned.
 */
export function setMockResponses(responses: MockResponse[]): void {
  mockResponses = [...responses];
}

/**
 * Add a single mock response to the queue.
 */
export function addMockResponse(response: MockResponse): void {
  mockResponses.push(response);
}

/**
 * Create a simple text response.
 */
export function createTextResponse(text: string): MockResponse {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
  };
}

/**
 * Create a tool use response.
 */
export function createToolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
  toolId = 'tool_123'
): MockResponse {
  return {
    content: [{ type: 'tool_use', id: toolId, name: toolName, input }],
    stop_reason: 'tool_use',
  };
}

/**
 * Create a response with both text and tool use.
 */
export function createMixedResponse(
  text: string,
  toolName: string,
  input: Record<string, unknown>,
  toolId = 'tool_123'
): MockResponse {
  return {
    content: [
      { type: 'text', text },
      { type: 'tool_use', id: toolId, name: toolName, input },
    ],
    stop_reason: 'tool_use',
  };
}

/**
 * Get all calls made to messages.create() for assertions.
 */
export function getCreateCalls(): CreateCall[] {
  return [...createCalls];
}

/**
 * Clear mock state. Call this in beforeEach.
 */
export function clearMockState(): void {
  mockResponses = [];
  createCalls = [];
}

// Mock the messages.create method
const mockCreate = vi.fn(async (params: {
  model: string;
  messages: unknown[];
  system?: string;
  max_tokens?: number;
  temperature?: number;
  tools?: unknown[];
}) => {
  createCalls.push({
    model: params.model,
    messages: params.messages,
    system: params.system,
    max_tokens: params.max_tokens,
    temperature: params.temperature,
    tools: params.tools,
  });

  // Return queued response or default
  if (mockResponses.length > 0) {
    return mockResponses.shift()!;
  }

  // Default response
  return {
    content: [{ type: 'text', text: 'Mock response' }],
    stop_reason: 'end_turn',
  };
});

// Mock Anthropic class
class MockAnthropic {
  messages = {
    create: mockCreate,
  };

  constructor(_config?: { apiKey?: string }) {
    // Constructor accepts config but doesn't use it in mock
  }
}

// Export as default (matches how Anthropic SDK is imported)
export default MockAnthropic;

// Also export the mock function for direct access in tests
export { mockCreate };

// Set up the module mock
vi.mock('@anthropic-ai/sdk', () => ({
  default: MockAnthropic,
}));
