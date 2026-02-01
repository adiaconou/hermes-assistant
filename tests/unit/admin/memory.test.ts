/**
 * Unit tests for admin memory API endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteMemoryStore } from '../../../src/services/memory/sqlite.js';
import { listMemories, deleteMemory } from '../../../src/admin/memory.js';
import { createMockReqRes } from '../../helpers/mock-http.js';
import fs from 'fs';
import path from 'path';

// Mock the memory store module
vi.mock('../../../src/services/memory/index.js', () => ({
  getMemoryStore: vi.fn(),
}));

import { getMemoryStore } from '../../../src/services/memory/index.js';

const TEST_DB_PATH = './data/test-admin-memory.db';

describe('Admin Memory API', () => {
  let store: SqliteMemoryStore;

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

    store = new SqliteMemoryStore(TEST_DB_PATH);

    // Mock getMemoryStore to return our test store
    vi.mocked(getMemoryStore).mockReturnValue(store);
  });

  afterEach(() => {
    store.close();
    // Clean up test DB
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    vi.clearAllMocks();
  });

  describe('GET /admin/api/memories', () => {
    it('returns empty array when no memories exist', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        url: '/admin/api/memories',
      });

      await listMemories(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ memories: [] });
    });

    it('returns all memories from all users', async () => {
      // Add memories for multiple users
      await store.addFact({
        phoneNumber: '+1111111111',
        fact: 'User 1 likes coffee',
        category: 'preferences',
        extractedAt: Date.now(),
      });

      await store.addFact({
        phoneNumber: '+2222222222',
        fact: 'User 2 has a dog',
        category: 'relationships',
        extractedAt: Date.now(),
      });

      await store.addFact({
        phoneNumber: '+1111111111',
        fact: 'User 1 works remotely',
        category: 'work',
        extractedAt: Date.now(),
      });

      const { req, res } = createMockReqRes({
        method: 'GET',
        url: '/admin/api/memories',
      });

      await listMemories(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { memories: Array<Record<string, unknown>> };
      expect(body.memories).toHaveLength(3);

      // Verify structure
      const memory = body.memories[0];
      expect(memory).toHaveProperty('id');
      expect(memory).toHaveProperty('phoneNumber');
      expect(memory).toHaveProperty('fact');
      expect(memory).toHaveProperty('extractedAt');
    });

    it('returns memories ordered by extractedAt descending', async () => {
      const baseTime = Date.now();

      await store.addFact({
        phoneNumber: '+1111111111',
        fact: 'First fact',
        extractedAt: baseTime,
      });

      await store.addFact({
        phoneNumber: '+1111111111',
        fact: 'Second fact',
        extractedAt: baseTime + 1000,
      });

      await store.addFact({
        phoneNumber: '+1111111111',
        fact: 'Third fact',
        extractedAt: baseTime + 2000,
      });

      const { req, res } = createMockReqRes({
        method: 'GET',
        url: '/admin/api/memories',
      });

      await listMemories(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { memories: Array<{ fact: string }> };
      expect(body.memories[0].fact).toBe('Third fact');
      expect(body.memories[1].fact).toBe('Second fact');
      expect(body.memories[2].fact).toBe('First fact');
    });
  });

  describe('DELETE /admin/api/memories/:id', () => {
    it('deletes a memory and returns 204', async () => {
      const added = await store.addFact({
        phoneNumber: '+1111111111',
        fact: 'Test fact to delete',
        extractedAt: Date.now(),
      });

      const { req, res } = createMockReqRes({
        method: 'DELETE',
        url: `/admin/api/memories/${added.id}`,
        params: { id: added.id },
      });

      await deleteMemory(req, res);

      expect(res.statusCode).toBe(204);

      // Verify it's deleted
      const facts = await store.getAllFacts();
      expect(facts).toHaveLength(0);
    });

    it('returns 404 for non-existent memory', async () => {
      const { req, res } = createMockReqRes({
        method: 'DELETE',
        url: '/admin/api/memories/non-existent-id',
        params: { id: 'non-existent-id' },
      });

      await deleteMemory(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Memory not found' });
    });

    it('only deletes the specified memory', async () => {
      const fact1 = await store.addFact({
        phoneNumber: '+1111111111',
        fact: 'Keep this fact',
        extractedAt: Date.now(),
      });

      const fact2 = await store.addFact({
        phoneNumber: '+1111111111',
        fact: 'Delete this fact',
        extractedAt: Date.now(),
      });

      const { req, res } = createMockReqRes({
        method: 'DELETE',
        url: `/admin/api/memories/${fact2.id}`,
        params: { id: fact2.id },
      });

      await deleteMemory(req, res);

      expect(res.statusCode).toBe(204);

      const facts = await store.getAllFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0].id).toBe(fact1.id);
    });
  });
});
