/**
 * Unit tests for SqliteMemoryStore.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryStore } from '../../src/domains/memory/repo/sqlite.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = './data/test-memory.db';

describe('SqliteMemoryStore', () => {
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
  });

  afterEach(() => {
    store.close();
    // Clean up test DB
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it('stores and retrieves facts', async () => {
    const fact = {
      phoneNumber: '+1234567890',
      fact: 'Likes black coffee',
      category: 'preferences',
      confidence: 0.6,
      sourceType: 'explicit' as const,
      extractedAt: Date.now(),
    };

    const added = await store.addFact(fact);
    const facts = await store.getFacts('+1234567890');

    expect(facts.length).toBe(1);
    expect(facts[0].id).toBe(added.id);
    expect(facts[0].fact).toBe('Likes black coffee');
    expect(facts[0].category).toBe('preferences');
    expect(facts[0].phoneNumber).toBe('+1234567890');
  });

  it('updates existing fact', async () => {
    const fact = {
      phoneNumber: '+1234567890',
      fact: 'Likes coffee',
      category: 'preferences',
      confidence: 0.6,
      sourceType: 'explicit' as const,
      extractedAt: Date.now(),
    };

    const added = await store.addFact(fact);

    // Update the fact
    await store.updateFact(added.id, {
      fact: 'Prefers black coffee',
      category: 'food',
    });

    const facts = await store.getFacts('+1234567890');

    expect(facts.length).toBe(1);
    expect(facts[0].fact).toBe('Prefers black coffee');
    expect(facts[0].category).toBe('food');
  });

  it('deletes fact', async () => {
    const fact = {
      phoneNumber: '+1234567890',
      fact: 'Has a dog named Max',
      category: 'relationships',
      confidence: 0.6,
      sourceType: 'explicit' as const,
      extractedAt: Date.now(),
    };

    const added = await store.addFact(fact);

    // Verify it exists
    let facts = await store.getFacts('+1234567890');
    expect(facts.length).toBe(1);

    // Delete
    await store.deleteFact(added.id);

    // Verify it's gone
    facts = await store.getFacts('+1234567890');
    expect(facts.length).toBe(0);
  });

  it('returns empty array for unknown phone number', async () => {
    const facts = await store.getFacts('+9999999999');
    expect(facts).toEqual([]);
  });

  it('stores multiple facts for same user', async () => {
    const phoneNumber = '+1234567890';

    await store.addFact({
      phoneNumber,
      fact: 'Likes black coffee',
      category: 'preferences',
      confidence: 0.6,
      sourceType: 'explicit',
      extractedAt: Date.now(),
    });

    await store.addFact({
      phoneNumber,
      fact: 'Has a dog named Max',
      category: 'relationships',
      confidence: 0.6,
      sourceType: 'explicit',
      extractedAt: Date.now(),
    });

    await store.addFact({
      phoneNumber,
      fact: 'Allergic to peanuts',
      category: 'health',
      confidence: 0.6,
      sourceType: 'explicit',
      extractedAt: Date.now(),
    });

    const facts = await store.getFacts(phoneNumber);
    expect(facts.length).toBe(3);
  });

  it('isolates facts by phone number', async () => {
    await store.addFact({
      phoneNumber: '+1111111111',
      fact: 'User 1 fact',
      confidence: 0.6,
      sourceType: 'explicit',
      extractedAt: Date.now(),
    });

    await store.addFact({
      phoneNumber: '+2222222222',
      fact: 'User 2 fact',
      confidence: 0.6,
      sourceType: 'explicit',
      extractedAt: Date.now(),
    });

    const user1Facts = await store.getFacts('+1111111111');
    const user2Facts = await store.getFacts('+2222222222');

    expect(user1Facts.length).toBe(1);
    expect(user2Facts.length).toBe(1);
    expect(user1Facts[0].fact).toBe('User 1 fact');
    expect(user2Facts[0].fact).toBe('User 2 fact');
  });

  it('orders facts by extractedAt descending', async () => {
    const phoneNumber = '+1234567890';
    const baseTime = Date.now();

    await store.addFact({
      phoneNumber,
      fact: 'First fact',
      confidence: 0.6,
      sourceType: 'explicit',
      extractedAt: baseTime,
    });

    await store.addFact({
      phoneNumber,
      fact: 'Second fact',
      confidence: 0.6,
      sourceType: 'explicit',
      extractedAt: baseTime + 1000,
    });

    await store.addFact({
      phoneNumber,
      fact: 'Third fact',
      confidence: 0.6,
      sourceType: 'explicit',
      extractedAt: baseTime + 2000,
    });

    const facts = await store.getFacts(phoneNumber);

    expect(facts[0].fact).toBe('Third fact');
    expect(facts[1].fact).toBe('Second fact');
    expect(facts[2].fact).toBe('First fact');
  });

  it('deletes stale low-confidence observations', async () => {
    const oldTimestamp = Date.now() - 181 * 24 * 60 * 60 * 1000;

    await store.addFact({
      phoneNumber: '+1234567890',
      fact: 'Old observation',
      confidence: 0.5,
      sourceType: 'explicit',
      extractedAt: oldTimestamp,
    });

    await store.addFact({
      phoneNumber: '+1234567890',
      fact: 'Old established fact',
      confidence: 0.7,
      sourceType: 'explicit',
      extractedAt: oldTimestamp,
    });

    const deleted = await store.deleteStaleObservations();
    expect(deleted).toBe(1);

    const facts = await store.getFacts('+1234567890');
    expect(facts).toHaveLength(1);
    expect(facts[0].fact).toBe('Old established fact');
  });
});
