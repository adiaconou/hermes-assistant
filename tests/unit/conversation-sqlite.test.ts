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
      // Should return the most recent 5 messages, in chronological order
      expect(history[0].content).toBe('Message 6');
      expect(history[4].content).toBe('Message 10');
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

    it('includes assistant messages when enabled', async () => {
      await store.addMessage('+1234567890', 'user', 'User msg');
      await store.addMessage('+1234567890', 'assistant', 'Assistant msg');

      const unprocessed = await store.getUnprocessedMessages({ includeAssistant: true });

      expect(unprocessed).toHaveLength(2);
      expect(unprocessed[0].role).toBe('user');
      expect(unprocessed[1].role).toBe('assistant');
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

  describe('addMessageMetadata / getMessageMetadata', () => {
    it('stores and retrieves image analysis metadata', async () => {
      const msg = await store.addMessage('+1234567890', 'user', 'Check this image');

      await store.addMessageMetadata(msg.id, '+1234567890', 'image_analysis', {
        driveFileId: 'abc123',
        driveUrl: 'https://drive.google.com/file/d/abc123',
        mimeType: 'image/jpeg',
        analysis: 'A wall calendar showing February 2026',
      });

      const metadataMap = await store.getMessageMetadata([msg.id], 'image_analysis');

      expect(metadataMap.size).toBe(1);
      const items = metadataMap.get(msg.id);
      expect(items).toBeDefined();
      expect(items).toHaveLength(1);
      expect(items![0].analysis).toContain('wall calendar');
      expect(items![0].driveFileId).toBe('abc123');
      expect(items![0].mimeType).toBe('image/jpeg');
    });

    it('returns empty map for messages without metadata', async () => {
      const msg = await store.addMessage('+1234567890', 'user', 'No image here');

      const metadataMap = await store.getMessageMetadata([msg.id], 'image_analysis');

      expect(metadataMap.size).toBe(0);
    });

    it('returns empty map for empty message ID array', async () => {
      const metadataMap = await store.getMessageMetadata([]);

      expect(metadataMap.size).toBe(0);
    });

    it('handles multiple metadata items for the same message', async () => {
      const msg = await store.addMessage('+1234567890', 'user', 'Multiple images');

      await store.addMessageMetadata(msg.id, '+1234567890', 'image_analysis', {
        driveFileId: 'img1',
        mimeType: 'image/jpeg',
        analysis: 'First image analysis',
      });

      await store.addMessageMetadata(msg.id, '+1234567890', 'image_analysis', {
        driveFileId: 'img2',
        mimeType: 'image/png',
        analysis: 'Second image analysis',
      });

      const metadataMap = await store.getMessageMetadata([msg.id], 'image_analysis');

      expect(metadataMap.size).toBe(1);
      const items = metadataMap.get(msg.id);
      expect(items).toHaveLength(2);
      expect(items![0].driveFileId).toBe('img1');
      expect(items![1].driveFileId).toBe('img2');
    });

    it('retrieves metadata for multiple messages', async () => {
      const msg1 = await store.addMessage('+1234567890', 'user', 'Image 1');
      const msg2 = await store.addMessage('+1234567890', 'user', 'Image 2');
      const msg3 = await store.addMessage('+1234567890', 'user', 'No image');

      await store.addMessageMetadata(msg1.id, '+1234567890', 'image_analysis', {
        driveFileId: 'file1',
        mimeType: 'image/jpeg',
        analysis: 'Analysis for image 1',
      });

      await store.addMessageMetadata(msg2.id, '+1234567890', 'image_analysis', {
        driveFileId: 'file2',
        mimeType: 'image/png',
        analysis: 'Analysis for image 2',
      });

      const metadataMap = await store.getMessageMetadata([msg1.id, msg2.id, msg3.id], 'image_analysis');

      expect(metadataMap.size).toBe(2);
      expect(metadataMap.has(msg1.id)).toBe(true);
      expect(metadataMap.has(msg2.id)).toBe(true);
      expect(metadataMap.has(msg3.id)).toBe(false);
    });

    it('filters by metadata kind', async () => {
      const msg = await store.addMessage('+1234567890', 'user', 'Test');

      await store.addMessageMetadata(msg.id, '+1234567890', 'image_analysis', {
        driveFileId: 'file1',
        mimeType: 'image/jpeg',
        analysis: 'Image analysis',
      });

      // Query with kind filter
      const imageMetadata = await store.getMessageMetadata([msg.id], 'image_analysis');
      expect(imageMetadata.size).toBe(1);

      // Query without kind filter should still return the metadata
      const allMetadata = await store.getMessageMetadata([msg.id]);
      expect(allMetadata.size).toBe(1);
    });
  });

  describe('boundary: media attachments parsing', () => {
    it('handles valid media attachments JSON', async () => {
      const attachments = [
        { driveFileId: 'abc', filename: 'photo.jpg', mimeType: 'image/jpeg' },
      ];
      const msg = await store.addMessage('+1234567890', 'user', 'Image', 'sms', attachments);

      const history = await store.getHistory('+1234567890');
      expect(history).toHaveLength(1);
      expect(history[0].mediaAttachments).toEqual(attachments);
    });

    it('returns undefined for malformed JSON in media_attachments', async () => {
      // Insert a message with corrupt media_attachments JSON directly
      const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
      db.prepare(`
        INSERT INTO conversation_messages
          (id, phone_number, role, content, channel, created_at, memory_processed, media_attachments)
        VALUES ('corrupt-json', '+1234567890', 'user', 'test', 'sms', ?, 0, 'not-valid-json')
      `).run(Date.now());

      const history = await store.getHistory('+1234567890');
      const corruptMsg = history.find(m => m.id === 'corrupt-json');
      expect(corruptMsg).toBeDefined();
      expect(corruptMsg!.mediaAttachments).toBeUndefined();
    });

    it('returns undefined for non-array JSON in media_attachments', async () => {
      const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
      db.prepare(`
        INSERT INTO conversation_messages
          (id, phone_number, role, content, channel, created_at, memory_processed, media_attachments)
        VALUES ('non-array', '+1234567890', 'user', 'test', 'sms', ?, 0, '{"not": "an array"}')
      `).run(Date.now());

      const history = await store.getHistory('+1234567890');
      const msg = history.find(m => m.id === 'non-array');
      expect(msg).toBeDefined();
      expect(msg!.mediaAttachments).toBeUndefined();
    });

    it('filters out array items missing required fields', async () => {
      const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
      const mixedJson = JSON.stringify([
        { driveFileId: 'good', filename: 'file.jpg', mimeType: 'image/jpeg' },
        { driveFileId: 'bad' }, // missing filename and mimeType
        { filename: 'also-bad.jpg', mimeType: 'image/png' }, // missing driveFileId
      ]);
      db.prepare(`
        INSERT INTO conversation_messages
          (id, phone_number, role, content, channel, created_at, memory_processed, media_attachments)
        VALUES ('mixed-items', '+1234567890', 'user', 'test', 'sms', ?, 0, ?)
      `).run(Date.now(), mixedJson);

      const history = await store.getHistory('+1234567890');
      const msg = history.find(m => m.id === 'mixed-items');
      expect(msg).toBeDefined();
      expect(msg!.mediaAttachments).toHaveLength(1);
      expect(msg!.mediaAttachments![0].driveFileId).toBe('good');
    });

    it('getUnprocessedMessages handles malformed media_attachments gracefully', async () => {
      const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
      db.prepare(`
        INSERT INTO conversation_messages
          (id, phone_number, role, content, channel, created_at, memory_processed, media_attachments)
        VALUES ('corrupt-unproc', '+1234567890', 'user', 'test', 'sms', ?, 0, 'broken-json')
      `).run(Date.now());

      const messages = await store.getUnprocessedMessages();
      const corruptMsg = messages.find(m => m.id === 'corrupt-unproc');
      expect(corruptMsg).toBeDefined();
      expect(corruptMsg!.mediaAttachments).toBeUndefined();
    });

    it('getRecentMedia skips messages with malformed media_attachments', async () => {
      const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
      // Insert a good message
      await store.addMessage('+1234567890', 'user', 'good', 'sms', [
        { driveFileId: 'id1', filename: 'pic.jpg', mimeType: 'image/jpeg' },
      ]);
      // Insert a corrupt message
      db.prepare(`
        INSERT INTO conversation_messages
          (id, phone_number, role, content, channel, created_at, memory_processed, media_attachments)
        VALUES ('corrupt-media', '+1234567890', 'user', 'bad', 'sms', ?, 0, '{invalid')
      `).run(Date.now());

      const media = await store.getRecentMedia('+1234567890');
      // Should get 1 valid attachment, skipping the corrupt one
      expect(media).toHaveLength(1);
      expect(media[0].attachment.driveFileId).toBe('id1');
    });
  });
});
