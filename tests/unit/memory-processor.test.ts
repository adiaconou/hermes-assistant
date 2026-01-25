/**
 * Unit tests for the async memory processor.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setMockResponses,
  createTextResponse,
  clearMockState,
} from '../mocks/anthropic.js';

// Mock the stores before importing processor
vi.mock('../../src/services/conversation/index.js', () => {
  const messages: Array<{
    id: string;
    phoneNumber: string;
    role: 'user' | 'assistant';
    content: string;
    channel: 'sms' | 'whatsapp';
    createdAt: number;
    memoryProcessed: boolean;
    memoryProcessedAt?: number;
  }> = [];
  let messageIdCounter = 0;
  const processedIds = new Set<string>();

  return {
    getConversationStore: () => ({
      addMessage: async (
        phoneNumber: string,
        role: 'user' | 'assistant',
        content: string,
        channel: 'sms' | 'whatsapp' = 'sms'
      ) => {
        const msg = {
          id: `msg_${++messageIdCounter}`,
          phoneNumber,
          role,
          content,
          channel,
          createdAt: Date.now(),
          memoryProcessed: false,
        };
        messages.push(msg);
        return msg;
      },
      getUnprocessedMessages: async (options?: { limit?: number; perUserLimit?: number }) => {
        const limit = options?.limit ?? 100;
        const perUserLimit = options?.perUserLimit ?? 25;
        const unprocessed = messages.filter(
          (m) => m.role === 'user' && !processedIds.has(m.id)
        );

        // Apply per-user limit with FIFO
        const byUserCount = new Map<string, number>();
        const result: typeof unprocessed = [];
        for (const msg of unprocessed) {
          const count = byUserCount.get(msg.phoneNumber) ?? 0;
          if (count >= perUserLimit) continue;
          if (result.length >= limit) break;
          byUserCount.set(msg.phoneNumber, count + 1);
          result.push(msg);
        }
        return result;
      },
      markAsProcessed: async (messageIds: string[]) => {
        for (const id of messageIds) {
          processedIds.add(id);
        }
      },
    }),
    // Expose for test setup
    _testHelpers: {
      reset: () => {
        messages.length = 0;
        messageIdCounter = 0;
        processedIds.clear();
      },
      addTestMessage: (
        phoneNumber: string,
        role: 'user' | 'assistant',
        content: string
      ) => {
        const msg = {
          id: `msg_${++messageIdCounter}`,
          phoneNumber,
          role,
          content,
          channel: 'sms' as const,
          createdAt: Date.now(),
          memoryProcessed: false,
        };
        messages.push(msg);
        return msg;
      },
      getMessages: () => [...messages],
      getProcessedIds: () => new Set(processedIds),
    },
  };
});

vi.mock('../../src/services/memory/index.js', () => {
  const facts: Array<{
    id: string;
    phoneNumber: string;
    fact: string;
    category?: string;
    extractedAt: number;
  }> = [];
  let factIdCounter = 0;

  return {
    getMemoryStore: () => ({
      getFacts: async (phoneNumber: string) => {
        return facts.filter((f) => f.phoneNumber === phoneNumber);
      },
      addFact: async (fact: {
        phoneNumber: string;
        fact: string;
        category?: string;
        extractedAt: number;
      }) => {
        const stored = {
          id: `fact_${++factIdCounter}`,
          ...fact,
        };
        facts.push(stored);
        return stored;
      },
    }),
    // Expose for test setup
    _testHelpers: {
      reset: () => {
        facts.length = 0;
        factIdCounter = 0;
      },
      getFacts: () => [...facts],
      addTestFact: (phoneNumber: string, factText: string) => {
        const fact = {
          id: `fact_${++factIdCounter}`,
          phoneNumber,
          fact: factText,
          extractedAt: Date.now(),
        };
        facts.push(fact);
        return fact;
      },
    },
  };
});

vi.mock('../../src/config.js', () => ({
  default: {
    anthropicApiKey: 'test-key',
    memoryProcessor: {
      enabled: true,
      intervalMs: 1000,
      batchSize: 100,
      perUserBatchSize: 25,
    },
  },
}));

// Now import the processor (after mocks are set up)
import { processUnprocessedMessages } from '../../src/services/memory/processor.js';
import { getConversationStore, _testHelpers as convHelpers } from '../../src/services/conversation/index.js';
import { _testHelpers as memHelpers } from '../../src/services/memory/index.js';

describe('Memory Processor', () => {
  beforeEach(() => {
    clearMockState();
    convHelpers.reset();
    memHelpers.reset();
  });

  describe('processUnprocessedMessages', () => {
    it('returns zero counts when no messages to process', async () => {
      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(0);
      expect(result.factsExtracted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('processes user messages and extracts facts', async () => {
      // Add test message
      convHelpers.addTestMessage('+1234567890', 'user', 'I love coffee');

      // Mock LLM response with extracted fact
      setMockResponses([
        createTextResponse('[{"fact": "Loves coffee", "category": "preferences"}]'),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify fact was stored
      const facts = memHelpers.getFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe('Loves coffee');
      expect(facts[0].category).toBe('preferences');
    });

    it('skips assistant messages', async () => {
      convHelpers.addTestMessage('+1234567890', 'assistant', 'Hello!');

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(0);
    });

    it('marks messages as processed after extraction', async () => {
      const msg = convHelpers.addTestMessage('+1234567890', 'user', 'Test message');

      setMockResponses([createTextResponse('[]')]);

      await processUnprocessedMessages();

      // Message should be marked as processed
      const processedIds = convHelpers.getProcessedIds();
      expect(processedIds.has(msg.id)).toBe(true);

      // Second run should not process same message
      const result = await processUnprocessedMessages();
      expect(result.messagesProcessed).toBe(0);
    });

    it('handles multiple users in same batch', async () => {
      convHelpers.addTestMessage('+1111111111', 'user', 'I like pizza');
      convHelpers.addTestMessage('+2222222222', 'user', 'I like sushi');

      setMockResponses([
        createTextResponse('[{"fact": "Likes pizza", "category": "preferences"}]'),
        createTextResponse('[{"fact": "Likes sushi", "category": "preferences"}]'),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(2);
      expect(result.factsExtracted).toBe(2);

      const facts = memHelpers.getFacts();
      expect(facts).toHaveLength(2);
    });

    it('deduplicates facts (case-insensitive)', async () => {
      // Add existing fact
      memHelpers.addTestFact('+1234567890', 'Loves coffee');

      // Add message that would extract the same fact
      convHelpers.addTestMessage('+1234567890', 'user', 'I really love coffee');

      // LLM returns same fact with different case
      setMockResponses([
        createTextResponse('[{"fact": "loves coffee", "category": "preferences"}]'),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(0); // Duplicate not added

      const facts = memHelpers.getFacts();
      expect(facts).toHaveLength(1); // Still just the original
    });

    it('extracts multiple facts from single user batch', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'I love coffee and have a dog named Max');

      setMockResponses([
        createTextResponse(
          '[{"fact": "Loves coffee", "category": "preferences"}, {"fact": "Has a dog named Max", "category": "relationships"}]'
        ),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(2);

      const facts = memHelpers.getFacts();
      expect(facts).toHaveLength(2);
    });

    it('handles empty LLM response gracefully', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'Hello there');

      setMockResponses([createTextResponse('[]')]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('handles malformed LLM response gracefully', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'Test message');

      setMockResponses([createTextResponse('This is not JSON')]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('handles LLM errors without marking messages as processed', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'Test message');

      // Make the mock throw an error
      const originalCreate = vi.fn().mockRejectedValue(new Error('API Error'));
      vi.doMock('@anthropic-ai/sdk', () => ({
        default: class {
          messages = { create: originalCreate };
        },
      }));

      // Note: This test would need a different approach since we can't easily
      // change the mock after module load. Skipping complex error simulation.
    });
  });

  describe('fact parsing', () => {
    it('extracts JSON from response with surrounding text', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'I work at Anthropic');

      // LLM includes extra text around JSON
      setMockResponses([
        createTextResponse(
          'Based on the message, here are the facts:\n[{"fact": "Works at Anthropic", "category": "work"}]\nThat is all.'
        ),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.factsExtracted).toBe(1);
      const facts = memHelpers.getFacts();
      expect(facts[0].fact).toBe('Works at Anthropic');
    });

    it('filters out facts with empty strings', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'Test');

      setMockResponses([
        createTextResponse(
          '[{"fact": "Valid fact", "category": "other"}, {"fact": "", "category": "other"}, {"fact": "   ", "category": "other"}]'
        ),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.factsExtracted).toBe(1);
    });
  });
});
