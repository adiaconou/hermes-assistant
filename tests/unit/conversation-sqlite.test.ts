/**
 * Unit tests for SqliteConversationStore.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConversationStore } from '../../src/services/conversation/sqlite.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = './data/test-conversation.db';

describe('SqliteConversationStore', () => {
  let store: SqliteConversationStore;

  beforeEach(() => {
    // Ensure test directory exists
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Remove test DB if exists
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    store = new SqliteConversationStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    // Clean up test DB
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('addMessage', () => {
    it('stores and retrieves messages', async () => {
      await store.addMessage('+1234567890', 'user', 'Hello', 'sms');
      await store.addMessage('+1234567890', 'assistant', 'Hi there!', 'sms');

      const history = await store.getHistory('+1234567890');

      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello');
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toBe('Hi there!');
    });

    it('sets default channel to sms', async () => {
      const msg = await store.addMessage('+1234567890', 'user', 'Test');

      expect(msg.channel).toBe('sms');
    });

    it('stores whatsapp channel correctly', async () => {
      const msg = await store.addMessage('+1234567890', 'user', 'Test', 'whatsapp');

      expect(msg.channel).toBe('whatsapp');
    });

    it('sets memoryProcessed to false by default', async () => {
      const msg = await store.addMessage('+1234567890', 'user', 'Test');

      expect(msg.memoryProcessed).toBe(false);
      expect(msg.memoryProcessedAt).toBeUndefined();
    });

    it('generates unique IDs for each message', async () => {
      const msg1 = await store.addMessage('+1234567890', 'user', 'Test 1');
      const msg2 = await store.addMessage('+1234567890', 'user', 'Test 2');

      expect(msg1.id).not.toBe(msg2.id);
    });
  });

  describe('getHistory', () => {
    it('returns messages in chronological order', async () => {
      await store.addMessage('+1234567890', 'user', 'First');
      await store.addMessage('+1234567890', 'assistant', 'Second');
      await store.addMessage('+1234567890', 'user', 'Third');

      const history = await store.getHistory('+1234567890');

      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Second');
      expect(history[2].content).toBe('Third');
    });

    it('limits results with limit option', async () => {
      for (let i = 1; i <= 10; i++) {
        await store.addMessage('+1234567890', 'user', `Message ${i}`);
      }

      const history = await store.getHistory('+1234567890', { limit: 5 });

      expect(history).toHaveLength(5);
    });

    it('filters by memoryProcessed status', async () => {
      const msg1 = await store.addMessage('+1234567890', 'user', 'Unprocessed 1');
      const msg2 = await store.addMessage('+1234567890', 'user', 'Unprocessed 2');
      await store.markAsProcessed([msg1.id]);

      const unprocessed = await store.getHistory('+1234567890', { memoryProcessed: false });
      const processed = await store.getHistory('+1234567890', { memoryProcessed: true });

      expect(unprocessed).toHaveLength(1);
      expect(unprocessed[0].content).toBe('Unprocessed 2');
      expect(processed).toHaveLength(1);
      expect(processed[0].content).toBe('Unprocessed 1');
    });

    it('filters by time range with since option', async () => {
      await store.addMessage('+1234567890', 'user', 'Old message');
      const middleTime = Date.now();

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10));

      await store.addMessage('+1234567890', 'user', 'New message');

      const newMessages = await store.getHistory('+1234567890', { since: middleTime });

      expect(newMessages).toHaveLength(1);
      expect(newMessages[0].content).toBe('New message');
    });

    it('filters by role', async () => {
      await store.addMessage('+1234567890', 'user', 'User message');
      await store.addMessage('+1234567890', 'assistant', 'Assistant message');

      const userOnly = await store.getHistory('+1234567890', { role: 'user' });

      expect(userOnly).toHaveLength(1);
      expect(userOnly[0].role).toBe('user');
    });

    it('returns empty array for unknown phone number', async () => {
      const history = await store.getHistory('+9999999999');
      expect(history).toEqual([]);
    });

    it('isolates messages by phone number', async () => {
      await store.addMessage('+1111111111', 'user', 'User 1 message');
      await store.addMessage('+2222222222', 'user', 'User 2 message');

      const user1History = await store.getHistory('+1111111111');
      const user2History = await store.getHistory('+2222222222');

      expect(user1History).toHaveLength(1);
      expect(user2History).toHaveLength(1);
      expect(user1History[0].content).toBe('User 1 message');
      expect(user2History[0].content).toBe('User 2 message');
    });

    it('returns messages for all users when phoneNumber is undefined', async () => {
      await store.addMessage('+1111111111', 'user', 'User 1');
      await store.addMessage('+2222222222', 'user', 'User 2');

      const allMessages = await store.getHistory(undefined, { limit: 100 });

      expect(allMessages).toHaveLength(2);
    });
  });

  describe('getUnprocessedMessages', () => {
    it('returns only unprocessed user messages', async () => {
      await store.addMessage('+1234567890', 'user', 'User msg');
      await store.addMessage('+1234567890', 'assistant', 'Assistant msg');

      const unprocessed = await store.getUnprocessedMessages();

      expect(unprocessed).toHaveLength(1);
      expect(unprocessed[0].role).toBe('user');
    });

    it('returns messages in FIFO order', async () => {
      await store.addMessage('+1234567890', 'user', 'First');
      await store.addMessage('+1234567890', 'user', 'Second');
      await store.addMessage('+1234567890', 'user', 'Third');

      const unprocessed = await store.getUnprocessedMessages();

      expect(unprocessed[0].content).toBe('First');
      expect(unprocessed[1].content).toBe('Second');
      expect(unprocessed[2].content).toBe('Third');
    });

    it('respects total limit', async () => {
      for (let i = 1; i <= 10; i++) {
        await store.addMessage('+1234567890', 'user', `Message ${i}`);
      }

      const unprocessed = await store.getUnprocessedMessages({ limit: 5 });

      expect(unprocessed).toHaveLength(5);
      expect(unprocessed[0].content).toBe('Message 1');
      expect(unprocessed[4].content).toBe('Message 5');
    });

    it('respects per-user limit', async () => {
      // Add 10 messages from user 1
      for (let i = 1; i <= 10; i++) {
        await store.addMessage('+1111111111', 'user', `User1 msg ${i}`);
      }

      // Add 5 messages from user 2
      for (let i = 1; i <= 5; i++) {
        await store.addMessage('+2222222222', 'user', `User2 msg ${i}`);
      }

      const unprocessed = await store.getUnprocessedMessages({
        limit: 100,
        perUserLimit: 3,
      });

      // Should get 3 from user 1 and 3 from user 2 (but user 2 only has 5, and FIFO applies)
      const user1Messages = unprocessed.filter((m) => m.phoneNumber === '+1111111111');
      const user2Messages = unprocessed.filter((m) => m.phoneNumber === '+2222222222');

      expect(user1Messages.length).toBeLessThanOrEqual(3);
      expect(user2Messages.length).toBeLessThanOrEqual(3);
    });

    it('maintains FIFO across users with per-user limit', async () => {
      // Add messages interleaved from two users
      await store.addMessage('+1111111111', 'user', 'User1 msg 1');
      await store.addMessage('+2222222222', 'user', 'User2 msg 1');
      await store.addMessage('+1111111111', 'user', 'User1 msg 2');
      await store.addMessage('+2222222222', 'user', 'User2 msg 2');
      await store.addMessage('+1111111111', 'user', 'User1 msg 3');
      await store.addMessage('+1111111111', 'user', 'User1 msg 4'); // Exceeds per-user limit of 2

      const unprocessed = await store.getUnprocessedMessages({
        limit: 100,
        perUserLimit: 2,
      });

      // Should include 2 from each user, skipping user1's 3rd and 4th
      expect(unprocessed).toHaveLength(4);

      const user1Messages = unprocessed.filter((m) => m.phoneNumber === '+1111111111');
      const user2Messages = unprocessed.filter((m) => m.phoneNumber === '+2222222222');

      expect(user1Messages).toHaveLength(2);
      expect(user2Messages).toHaveLength(2);
    });

    it('excludes already processed messages', async () => {
      const msg1 = await store.addMessage('+1234567890', 'user', 'Processed');
      await store.addMessage('+1234567890', 'user', 'Unprocessed');

      await store.markAsProcessed([msg1.id]);

      const unprocessed = await store.getUnprocessedMessages();

      expect(unprocessed).toHaveLength(1);
      expect(unprocessed[0].content).toBe('Unprocessed');
    });
  });

  describe('markAsProcessed', () => {
    it('marks messages as processed', async () => {
      const msg = await store.addMessage('+1234567890', 'user', 'Test');

      await store.markAsProcessed([msg.id]);

      const history = await store.getHistory('+1234567890', { memoryProcessed: true });
      expect(history).toHaveLength(1);
      expect(history[0].memoryProcessed).toBe(true);
      expect(history[0].memoryProcessedAt).toBeDefined();
    });

    it('marks multiple messages at once', async () => {
      const msg1 = await store.addMessage('+1234567890', 'user', 'Test 1');
      const msg2 = await store.addMessage('+1234567890', 'user', 'Test 2');
      const msg3 = await store.addMessage('+1234567890', 'user', 'Test 3');

      await store.markAsProcessed([msg1.id, msg2.id]);

      const processed = await store.getHistory('+1234567890', { memoryProcessed: true });
      const unprocessed = await store.getHistory('+1234567890', { memoryProcessed: false });

      expect(processed).toHaveLength(2);
      expect(unprocessed).toHaveLength(1);
      expect(unprocessed[0].id).toBe(msg3.id);
    });

    it('handles empty array', async () => {
      // Should not throw
      await store.markAsProcessed([]);
    });
  });
});
