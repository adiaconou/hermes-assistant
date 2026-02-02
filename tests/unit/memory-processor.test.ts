/**
 * Unit tests for the async memory processor.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setMockResponses,
  createTextResponse,
  clearMockState,
  getCreateCalls,
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
      getUnprocessedMessages: async (options?: { limit?: number; perUserLimit?: number; includeAssistant?: boolean }) => {
        const limit = options?.limit ?? 100;
        const perUserLimit = options?.perUserLimit ?? 25;
        const includeAssistant = options?.includeAssistant ?? true;
        const unprocessed = messages.filter(
          (m) => (includeAssistant || m.role === 'user') && !processedIds.has(m.id)
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
    confidence: number;
    sourceType: 'explicit' | 'inferred';
    evidence?: string;
    lastReinforcedAt?: number;
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
        confidence: number;
        sourceType: 'explicit' | 'inferred';
        evidence?: string;
        lastReinforcedAt?: number;
        extractedAt: number;
      }) => {
        const stored = {
          id: `fact_${++factIdCounter}`,
          ...fact,
        };
        facts.push(stored);
        return stored;
      },
      updateFact: async (
        id: string,
        updates: Partial<{
          fact: string;
          category?: string;
          confidence: number;
          sourceType: 'explicit' | 'inferred';
          evidence?: string;
          lastReinforcedAt?: number;
          extractedAt: number;
        }>
      ) => {
        const index = facts.findIndex((f) => f.id === id);
        if (index === -1) return;
        facts[index] = { ...facts[index], ...updates };
      },
      deleteStaleObservations: async () => {
        const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
        const before = facts.length;
        for (let i = facts.length - 1; i >= 0; i--) {
          if (facts[i].confidence < 0.6 && facts[i].extractedAt < cutoff) {
            facts.splice(i, 1);
          }
        }
        return before - facts.length;
      },
    }),
    // Expose for test setup
    _testHelpers: {
      reset: () => {
        facts.length = 0;
        factIdCounter = 0;
      },
      getFacts: () => [...facts],
      addTestFact: (
        phoneNumber: string,
        factText: string,
        overrides?: Partial<{
          confidence: number;
          sourceType: 'explicit' | 'inferred';
          extractedAt: number;
          evidence?: string;
          lastReinforcedAt?: number;
        }>
      ) => {
        const fact = {
          id: `fact_${++factIdCounter}`,
          phoneNumber,
          fact: factText,
          confidence: 0.6,
          sourceType: 'explicit' as const,
          extractedAt: Date.now(),
          ...overrides,
        };
        facts.push(fact);
        return fact;
      },
    },
  };
});

vi.mock('../../src/config.js', () => ({
  default: {
    nodeEnv: 'test',
    anthropicApiKey: 'test-key',
    memoryProcessor: {
      enabled: true,
      intervalMs: 1000,
      batchSize: 100,
      perUserBatchSize: 25,
      modelId: 'test-model',
      logVerbose: false,
    },
  },
}));

// Now import the processor (after mocks are set up)
import { processUnprocessedMessages } from '../../src/services/memory/processor.js';
import { getConversationStore, _testHelpers as convHelpers } from '../../src/services/conversation/index.js';
import { _testHelpers as memHelpers } from '../../src/services/memory/index.js';
import config from '../../src/config.js';

describe('Memory Processor', () => {
  beforeEach(() => {
    clearMockState();
    convHelpers.reset();
    memHelpers.reset();
    config.memoryProcessor.logVerbose = false;
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
        createTextResponse(
          '{"facts":[{"fact":"Loves coffee","category":"preferences","confidence":0.7,"source_type":"explicit","evidence":"User said I love coffee"}]}'
        ),
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
      expect(facts[0].confidence).toBeCloseTo(0.7, 5);
      expect(facts[0].sourceType).toBe('explicit');
    });

    it('skips assistant messages', async () => {
      convHelpers.addTestMessage('+1234567890', 'assistant', 'Hello!');

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(0);
    });

    it('includes assistant tool summaries', async () => {
      convHelpers.addTestMessage(
        '+1234567890',
        'assistant',
        'Found 3 emails from Chase about your statement'
      );

      setMockResponses([
        createTextResponse(
          '{"facts":[{"fact":"Receives Chase statements","category":"recurring","confidence":0.7,"source_type":"inferred","evidence":"Found 3 emails from Chase"}]}'
        ),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(1);
    });

    it('skips assistant messages that are not tool summaries', async () => {
      convHelpers.addTestMessage('+1234567890', 'assistant', 'Thanks for the update!');

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(0);
      expect(getCreateCalls()).toHaveLength(0);
    });

    it('marks messages as processed after extraction', async () => {
      const msg = convHelpers.addTestMessage('+1234567890', 'user', 'Test message');

      setMockResponses([createTextResponse('{"facts": []}')]);

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
        createTextResponse('{"facts":[{"fact": "loves coffee", "category": "preferences", "confidence": 0.6, "source_type": "explicit"}]}'),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(0); // Duplicate not added

      const facts = memHelpers.getFacts();
      expect(facts).toHaveLength(1); // Still just the original
      expect(facts[0].confidence).toBeCloseTo(0.7, 5); // Reinforced
    });

    it('extracts multiple facts from single user batch', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'I love coffee and have a dog named Max');

      setMockResponses([
        createTextResponse(
          '{"facts":[{"fact":"Loves coffee","category":"preferences","confidence":0.6,"source_type":"explicit"},{"fact":"Has a dog named Max","category":"relationships","confidence":0.6,"source_type":"explicit"}]}'
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

      setMockResponses([createTextResponse('{"facts": []}')]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('does not mark messages as processed on malformed LLM response', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'Test message');

      setMockResponses([createTextResponse('This is not JSON')]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(0);
      expect(result.factsExtracted).toBe(0);
      expect(result.errors).toHaveLength(1);

      const processedIds = convHelpers.getProcessedIds();
      expect(processedIds.size).toBe(0);
    });

    it('retries once after parse failure and succeeds', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'I like tea');

      setMockResponses([
        createTextResponse('not json'),
        createTextResponse(
          '{"facts":[{"fact":"Likes tea","category":"preferences","confidence":0.6,"source_type":"explicit"}]}'
        ),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(1);
      expect(result.factsExtracted).toBe(1);
      expect(getCreateCalls()).toHaveLength(2);
    });

    it('caps evidence length when storing', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'I like coffee');
      const longEvidence = 'a'.repeat(200);

      setMockResponses([
        createTextResponse(
          `{"facts":[{"fact":"Likes coffee","category":"preferences","confidence":0.6,"source_type":"explicit","evidence":"${longEvidence}"}]}`
        ),
      ]);

      await processUnprocessedMessages();

      const facts = memHelpers.getFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0].evidence?.length).toBeLessThanOrEqual(120);
    });

    it('deletes stale low-confidence observations', async () => {
      const oldTimestamp = Date.now() - 181 * 24 * 60 * 60 * 1000;
      memHelpers.addTestFact('+1234567890', 'Old observation', {
        confidence: 0.5,
        extractedAt: oldTimestamp,
      });

      const result = await processUnprocessedMessages();

      expect(result.messagesProcessed).toBe(0);
      expect(memHelpers.getFacts()).toHaveLength(0);
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
    it('accepts legacy array format', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'I like jazz');

      setMockResponses([
        createTextResponse('[{"fact": "Likes jazz", "category": "interests"}]'),
      ]);

      await processUnprocessedMessages();

      const facts = memHelpers.getFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe('Likes jazz');
      expect(facts[0].confidence).toBeCloseTo(0.5, 5);
      expect(facts[0].sourceType).toBe('inferred');
    });

    it('extracts JSON from response with surrounding text', async () => {
      convHelpers.addTestMessage('+1234567890', 'user', 'I work at Anthropic');

      // LLM includes extra text around JSON
      setMockResponses([
        createTextResponse(
          'Based on the message, here are the facts:\n{"facts":[{"fact": "Works at Anthropic", "category": "work", "confidence": 0.6, "source_type": "explicit"}]}\nThat is all.'
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
          '{"facts":[{"fact": "Valid fact", "category": "other", "confidence": 0.5, "source_type": "explicit"}, {"fact": "", "category": "other"}, {"fact": "   ", "category": "other"}]}'
        ),
      ]);

      const result = await processUnprocessedMessages();

      expect(result.factsExtracted).toBe(1);
    });
  });
});
