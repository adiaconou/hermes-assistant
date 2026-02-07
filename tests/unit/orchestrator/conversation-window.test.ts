/**
 * Unit tests for the conversation window module.
 *
 * Tests conversation history filtering and formatting.
 */

import { describe, it, expect } from 'vitest';
import {
  getRelevantHistory,
  formatHistoryForPrompt,
  getWindowStats,
} from '../../../src/orchestrator/conversation-window.js';
import type { ConversationMessage } from '../../../src/services/conversation/types.js';

/**
 * Helper to create a conversation message.
 */
function createMessage(
  content: string,
  role: 'user' | 'assistant',
  hoursAgo: number = 0
): ConversationMessage {
  return {
    id: Math.random().toString(36).substring(7),
    phoneNumber: '+1234567890',
    role,
    content,
    channel: 'sms',
    createdAt: Date.now() - hoursAgo * 60 * 60 * 1000,
  };
}

describe('getRelevantHistory', () => {
  describe('empty input', () => {
    it('should return empty array for empty input', () => {
      const result = getRelevantHistory([]);
      expect(result).toEqual([]);
    });
  });

  describe('age filtering', () => {
    it('should exclude messages older than maxAgeHours', () => {
      const messages = [
        createMessage('Old message', 'user', 25), // 25 hours ago
        createMessage('Recent message', 'user', 1), // 1 hour ago
      ];

      const result = getRelevantHistory(messages, {
        maxAgeHours: 24,
        maxMessages: 20,
        maxTokens: 4000,
      });

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Recent message');
    });

    it('should include messages within maxAgeHours', () => {
      const messages = [
        createMessage('Message 1', 'user', 23), // 23 hours ago
        createMessage('Message 2', 'assistant', 22), // 22 hours ago
        createMessage('Message 3', 'user', 1), // 1 hour ago
      ];

      const result = getRelevantHistory(messages, {
        maxAgeHours: 24,
        maxMessages: 20,
        maxTokens: 4000,
      });

      expect(result).toHaveLength(3);
    });
  });

  describe('count limiting', () => {
    it('should limit to maxMessages most recent', () => {
      const messages = [
        createMessage('Message 1', 'user', 5),
        createMessage('Message 2', 'assistant', 4),
        createMessage('Message 3', 'user', 3),
        createMessage('Message 4', 'assistant', 2),
        createMessage('Message 5', 'user', 1),
      ];

      const result = getRelevantHistory(messages, {
        maxAgeHours: 24,
        maxMessages: 3,
        maxTokens: 4000,
      });

      expect(result).toHaveLength(3);
      // Should have the 3 most recent in chronological order
      expect(result[0].content).toBe('Message 3');
      expect(result[1].content).toBe('Message 4');
      expect(result[2].content).toBe('Message 5');
    });

    it('should return all messages if under maxMessages limit', () => {
      const messages = [
        createMessage('Message 1', 'user', 2),
        createMessage('Message 2', 'assistant', 1),
      ];

      const result = getRelevantHistory(messages, {
        maxAgeHours: 24,
        maxMessages: 10,
        maxTokens: 4000,
      });

      expect(result).toHaveLength(2);
    });
  });

  describe('token limiting', () => {
    it('should trim to token budget keeping most recent', () => {
      const messages = [
        createMessage('A'.repeat(1000), 'user', 3), // ~250 tokens
        createMessage('B'.repeat(1000), 'assistant', 2), // ~250 tokens
        createMessage('C'.repeat(1000), 'user', 1), // ~250 tokens
      ];

      const result = getRelevantHistory(messages, {
        maxAgeHours: 24,
        maxMessages: 20,
        maxTokens: 700, // ~700 tokens: each 1000-char msg is ~304 tokens at 3.3 chars/token
      });

      // Should keep most recent messages that fit
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('B'.repeat(1000));
      expect(result[1].content).toBe('C'.repeat(1000));
    });

    it('should return empty if first message exceeds budget', () => {
      const messages = [
        createMessage('A'.repeat(20000), 'user', 1), // ~6061 tokens at 3.3 chars/token
      ];

      const result = getRelevantHistory(messages, {
        maxAgeHours: 24,
        maxMessages: 20,
        maxTokens: 100,
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('chronological ordering', () => {
    it('should return messages in chronological order (oldest first)', () => {
      const messages = [
        createMessage('Third', 'user', 1),
        createMessage('First', 'user', 3),
        createMessage('Second', 'assistant', 2),
      ];

      const result = getRelevantHistory(messages, {
        maxAgeHours: 24,
        maxMessages: 20,
        maxTokens: 4000,
      });

      expect(result[0].content).toBe('First');
      expect(result[1].content).toBe('Second');
      expect(result[2].content).toBe('Third');
    });
  });

  describe('default config', () => {
    it('should use default config when not provided', () => {
      const messages = [
        createMessage('Message', 'user', 1),
      ];

      // Should not throw and return the message
      const result = getRelevantHistory(messages);

      expect(result).toHaveLength(1);
    });
  });
});

describe('formatHistoryForPrompt', () => {
  it('should return placeholder for empty history', () => {
    const result = formatHistoryForPrompt([]);

    expect(result).toBe('(No recent conversation history)');
  });

  it('should format user and assistant messages', () => {
    const messages = [
      createMessage('Hello', 'user', 2),
      createMessage('Hi there!', 'assistant', 1),
    ];

    const result = formatHistoryForPrompt(messages);

    expect(result).toContain('User: Hello');
    expect(result).toContain('Assistant: Hi there!');
  });

  it('should join messages with newlines', () => {
    const messages = [
      createMessage('First', 'user', 2),
      createMessage('Second', 'assistant', 1),
    ];

    const result = formatHistoryForPrompt(messages);
    const lines = result.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('User: First');
    expect(lines[1]).toBe('Assistant: Second');
  });
});

describe('getWindowStats', () => {
  it('should return zero stats for empty array', () => {
    const stats = getWindowStats([]);

    expect(stats).toEqual({
      messageCount: 0,
      totalTokens: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
    });
  });

  it('should calculate correct message count', () => {
    const messages = [
      createMessage('One', 'user', 3),
      createMessage('Two', 'assistant', 2),
      createMessage('Three', 'user', 1),
    ];

    const stats = getWindowStats(messages);

    expect(stats.messageCount).toBe(3);
  });

  it('should estimate tokens correctly', () => {
    const messages = [
      createMessage('A'.repeat(100), 'user', 1), // ~25 tokens
    ];

    const stats = getWindowStats(messages);

    // 100 chars / 3.3 = 30.3 → ceil = 31 tokens
    expect(stats.totalTokens).toBe(31);
  });

  it('should track oldest and newest timestamps', () => {
    const now = Date.now();
    const messages: ConversationMessage[] = [
      {
        id: '1',
        phoneNumber: '+1234567890',
        role: 'user',
        content: 'First',
        channel: 'sms',
        createdAt: now - 3000,
      },
      {
        id: '2',
        phoneNumber: '+1234567890',
        role: 'assistant',
        content: 'Second',
        channel: 'sms',
        createdAt: now - 2000,
      },
      {
        id: '3',
        phoneNumber: '+1234567890',
        role: 'user',
        content: 'Third',
        channel: 'sms',
        createdAt: now - 1000,
      },
    ];

    const stats = getWindowStats(messages);

    expect(stats.oldestTimestamp).toBe(now - 3000);
    expect(stats.newestTimestamp).toBe(now - 1000);
  });
});
