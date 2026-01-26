# Async Memory Processing System - Implementation Plan

## Problem

Memory extraction currently happens synchronously during chat via the `extract_memory` tool. This is inefficient because:
1. It adds latency to conversations
2. Relies on LLM deciding when to extract (may miss things)
3. Can't process historical conversations

## Solution Overview

Move memory extraction to an asynchronous background job that periodically processes new messages. Keep existing memory tools for explicit user requests.

**Key Design Principles:**
- Uses SQLite (already in use) - no external dependencies
- Follows existing scheduler pattern - portable across deployments
- Messages must be persisted to enable tracking
- Process user messages only (assistant text not needed for facts)
- Keep FIFO ordering to avoid starving later users
- Single instance only (no multi-worker leasing)

---

## Step-by-Step Implementation Checklist

### Step 1: Create Conversation Store Types
- [ ] Create `src/services/conversation/types.ts`
- [ ] Define `ConversationMessage` interface
- [ ] Define `ConversationStore` interface
- [ ] Export types

### Step 2: Create SQLite Conversation Store
- [ ] Create `src/services/conversation/sqlite.ts`
- [ ] Implement schema initialization (create table + indexes)
- [ ] Implement `addMessage()` - insert with UUID, timestamp
- [ ] Implement `getHistory()` for chat use (per user, limit only)
- [ ] Implement `getUnprocessedMessages()` for processor use:
  - [ ] FIFO by `created_at` (global)
  - [ ] Filter to `role = 'user'`
  - [ ] Limit total messages and per-user messages
- [ ] Implement `markAsProcessed()` - update flag and timestamp for message IDs

### Step 3: Create Conversation Store Factory
- [ ] Create `src/services/conversation/index.ts`
- [ ] Implement singleton pattern (follow `src/services/memory/index.ts`)
- [ ] Export `getConversationStore()` factory function
- [ ] Export types

### Step 4: Add Configuration
- [ ] Modify `src/config.ts`
- [ ] Add `conversation.sqlitePath` config
- [ ] Add `memoryProcessor.intervalMs` (default: 300000 = 5 min)
- [ ] Add `memoryProcessor.batchSize` (default: 100 total messages)
- [ ] Add `memoryProcessor.perUserBatchSize` (default: 25)
- [ ] Add `memoryProcessor.enabled` (default: true)

### Step 5: Update Conversation Module
- [ ] Modify `src/conversation.ts`
- [ ] Import conversation store
- [ ] Update `addMessage()` to accept optional `channel` parameter
- [ ] Replace in-memory Map operations with store calls
- [ ] Keep function signatures backward-compatible
- [ ] Make functions async (update callers as needed)

### Step 6: Update SMS Route
- [ ] Modify `src/routes/sms.ts`
- [ ] Detect channel from `From` field (sms vs whatsapp:+number)
- [ ] Pass channel to `addMessage()` calls

### Step 7: Create Memory Processor
- [ ] Create `src/services/memory/processor.ts`
- [ ] Define `ProcessingResult` interface
- [ ] Implement `processUnprocessedMessages()`:
  - [ ] Get unprocessed user messages (FIFO) with per-user cap
  - [ ] For each user, load existing facts
  - [ ] Build extraction prompt with messages + existing facts
  - [ ] Call LLM with JSON output format
  - [ ] Parse response, store new facts
  - [ ] Mark messages as processed
- [ ] Add structured logging (JSON format)
- [ ] Handle errors (LLM failure = retry, parse failure = skip)

### Step 8: Create Memory Processor Poller
- [ ] Add poller to `src/services/memory/processor.ts`
- [ ] Create poller using `setInterval` (follow scheduler pattern)
- [ ] Add `isProcessing` guard to prevent overlapping runs
- [ ] Export `startMemoryProcessor()` and `stopMemoryProcessor()`

### Step 9: Initialize in Application Entry
- [ ] Modify `src/index.ts`
- [ ] Import conversation store and memory processor
- [ ] Initialize conversation store (ensure DB created)
- [ ] Start memory processor after server ready (if enabled)
- [ ] Add to graceful shutdown

### Step 10: Testing
- [ ] Write unit tests for conversation store
- [ ] Write unit tests for memory processor
- [ ] Manual test: send messages, wait for processor cycle, verify facts

---

## Detailed Implementation Guide

### Step 1: Create Conversation Store Types

**File: `src/services/conversation/types.ts`**

```typescript
/**
 * Conversation Service Types
 *
 * Defines interfaces for persistent conversation storage
 * with memory processing tracking.
 */

/**
 * A single message in a conversation.
 */
export interface ConversationMessage {
  /** Unique identifier for this message */
  id: string;

  /** Phone number of the user */
  phoneNumber: string;

  /** Message role: user or assistant */
  role: 'user' | 'assistant';

  /** Message content */
  content: string;

  /** Channel: sms or whatsapp */
  channel: 'sms' | 'whatsapp';

  /** Unix timestamp (milliseconds) when message was created */
  createdAt: number;

  /** Whether this message has been processed for memory extraction */
  memoryProcessed: boolean;

  /** Unix timestamp (milliseconds) when memory was processed */
  memoryProcessedAt?: number;
}

/**
 * Options for filtering conversation history.
 */
export interface GetHistoryOptions {
  /** Maximum number of messages to return (default: 50) */
  limit?: number;

  /** Filter by memory processing status */
  memoryProcessed?: boolean;

  /** Only include messages created after this timestamp (milliseconds) */
  since?: number;

  /** Only include messages created before this timestamp (milliseconds) */
  until?: number;

  /** Filter by role */
  role?: 'user' | 'assistant';
}

/**
 * Interface for conversation storage operations.
 */
export interface ConversationStore {
  /**
   * Add a message to the conversation.
   * @returns The created message with generated ID
   */
  addMessage(
    phoneNumber: string,
    role: 'user' | 'assistant',
    content: string,
    channel?: 'sms' | 'whatsapp'
  ): Promise<ConversationMessage>;

  /**
   * Get conversation history for a user.
   * Results are returned in chronological order (oldest first).
   * @param phoneNumber User's phone number (optional - if omitted, returns messages for all users)
   * @param options Optional filters
   */
  getHistory(phoneNumber?: string, options?: GetHistoryOptions): Promise<ConversationMessage[]>;

  /**
   * Get unprocessed user messages for async memory extraction.
   * Results are returned in chronological order (oldest first).
   * @param options Optional filters and limits
   */
  getUnprocessedMessages(options?: {
    /** Maximum total messages to return */
    limit?: number;
    /** Maximum messages per user */
    perUserLimit?: number;
  }): Promise<ConversationMessage[]>;

  /**
   * Mark messages as processed for memory extraction.
   * @param messageIds Array of message IDs to mark
   */
  markAsProcessed(messageIds: string[]): Promise<void>;
}
```

---

### Step 2: Create SQLite Conversation Store

**File: `src/services/conversation/sqlite.ts`**

```typescript
/**
 * @fileoverview SQLite conversation store.
 *
 * Stores conversation messages with memory processing tracking.
 * Follows the pattern established in src/services/memory/sqlite.ts.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { ConversationStore, ConversationMessage, GetHistoryOptions } from './types.js';

/**
 * SQLite implementation of conversation store.
 */
export class SqliteConversationStore implements ConversationStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        phone_number TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'sms',
        created_at INTEGER NOT NULL,
        memory_processed INTEGER NOT NULL DEFAULT 0,
        memory_processed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_messages_phone
        ON conversation_messages(phone_number, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_messages_unprocessed
        ON conversation_messages(memory_processed, created_at)
        WHERE memory_processed = 0;
    `);
  }

  async addMessage(
    phoneNumber: string,
    role: 'user' | 'assistant',
    content: string,
    channel: 'sms' | 'whatsapp' = 'sms'
  ): Promise<ConversationMessage> {
    const id = randomUUID();
    const createdAt = Date.now();

    this.db
      .prepare(
        `INSERT INTO conversation_messages
         (id, phone_number, role, content, channel, created_at, memory_processed)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run(id, phoneNumber, role, content, channel, createdAt);

    return {
      id,
      phoneNumber,
      role,
      content,
      channel,
      createdAt,
      memoryProcessed: false,
    };
  }

  async getHistory(
    phoneNumber?: string,
    options: GetHistoryOptions = {}
  ): Promise<ConversationMessage[]> {
    const { limit = 50, memoryProcessed, since, until, role } = options;

    // Build dynamic WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (phoneNumber) {
      conditions.push('phone_number = ?');
      params.push(phoneNumber);
    }

    if (memoryProcessed !== undefined) {
      conditions.push('memory_processed = ?');
      params.push(memoryProcessed ? 1 : 0);
    }

    if (since !== undefined) {
      conditions.push('created_at >= ?');
      params.push(since);
    }

    if (until !== undefined) {
      conditions.push('created_at <= ?');
      params.push(until);
    }

    if (role) {
      conditions.push('role = ?');
      params.push(role);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Order by created_at for chat history
    const orderBy = 'ORDER BY created_at ASC';

    const query = `
      SELECT id, phone_number, role, content, channel, created_at,
             memory_processed, memory_processed_at
      FROM conversation_messages
      ${whereClause}
      ${orderBy}
      LIMIT ?
    `;

    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      phone_number: string;
      role: string;
      content: string;
      channel: string;
      created_at: number;
      memory_processed: number;
      memory_processed_at: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      phoneNumber: row.phone_number,
      role: row.role as 'user' | 'assistant',
      content: row.content,
      channel: row.channel as 'sms' | 'whatsapp',
      createdAt: row.created_at,
      memoryProcessed: row.memory_processed === 1,
      memoryProcessedAt: row.memory_processed_at ?? undefined,
    }));
  }

  async getUnprocessedMessages(options?: {
    limit?: number;
    perUserLimit?: number;
  }): Promise<ConversationMessage[]> {
    const limit = options?.limit ?? 100;
    const perUserLimit = options?.perUserLimit ?? 25;

    // FIFO across all users, user-role only, with per-user cap
    const rows = this.db.prepare(
      `
      SELECT id, phone_number, role, content, channel, created_at,
             memory_processed, memory_processed_at
      FROM conversation_messages
      WHERE memory_processed = 0 AND role = 'user'
      ORDER BY created_at ASC
      `
    ).all() as Array<{
      id: string;
      phone_number: string;
      role: string;
      content: string;
      channel: string;
      created_at: number;
      memory_processed: number;
      memory_processed_at: number | null;
    }>;

    const byUserCount = new Map<string, number>();
    const limited: typeof rows = [];
    for (const row of rows) {
      const count = byUserCount.get(row.phone_number) ?? 0;
      if (count >= perUserLimit) continue;
      if (limited.length >= limit) break;
      byUserCount.set(row.phone_number, count + 1);
      limited.push(row);
    }

    return limited.map((row) => ({
      id: row.id,
      phoneNumber: row.phone_number,
      role: row.role as 'user' | 'assistant',
      content: row.content,
      channel: row.channel as 'sms' | 'whatsapp',
      createdAt: row.created_at,
      memoryProcessed: row.memory_processed === 1,
      memoryProcessedAt: row.memory_processed_at ?? undefined,
    }));
  }

  async markAsProcessed(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;

    const now = Date.now();
    const placeholders = messageIds.map(() => '?').join(', ');

    this.db
      .prepare(
        `UPDATE conversation_messages
         SET memory_processed = 1, memory_processed_at = ?
         WHERE id IN (${placeholders})`
      )
      .run(now, ...messageIds);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
```

---

### Step 3: Create Conversation Store Factory

**File: `src/services/conversation/index.ts`**

```typescript
/**
 * @fileoverview Conversation store factory.
 *
 * Returns conversation store instance.
 * Singleton pattern - returns the same instance on repeated calls.
 */

import config from '../../config.js';
import type { ConversationStore, ConversationMessage, GetHistoryOptions } from './types.js';
import { SqliteConversationStore } from './sqlite.js';

export type { ConversationStore, ConversationMessage, GetHistoryOptions } from './types.js';

let instance: SqliteConversationStore | null = null;

/**
 * Get the conversation store instance.
 *
 * Returns a singleton instance that persists across calls.
 */
export function getConversationStore(): ConversationStore {
  if (instance) {
    return instance;
  }

  instance = new SqliteConversationStore(config.conversation.sqlitePath);
  return instance;
}

/**
 * Close the conversation store.
 * Call this during graceful shutdown.
 */
export function closeConversationStore(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/**
 * Reset the conversation store instance.
 * Useful for tests.
 */
export function resetConversationStore(): void {
  instance = null;
}
```

---

### Step 4: Add Configuration

**Modify: `src/config.ts`**

Add after the `memory` section:

```typescript
/** Conversation storage configuration */
conversation: {
  /** Path to SQLite database file */
  sqlitePath: process.env.CONVERSATION_DB_PATH ||
    (process.env.NODE_ENV === 'production' ? '/app/data/conversation.db' : './data/conversation.db'),
},

/** Async memory processor configuration */
memoryProcessor: {
  /** Interval between processing runs in milliseconds (default: 5 minutes) */
  intervalMs: parseInt(process.env.MEMORY_PROCESSOR_INTERVAL_MS || '300000', 10),
  /** Maximum messages to process per run */
  batchSize: parseInt(process.env.MEMORY_PROCESSOR_BATCH_SIZE || '100', 10),
  /** Maximum messages per user per run */
  perUserBatchSize: parseInt(process.env.MEMORY_PROCESSOR_PER_USER_BATCH_SIZE || '25', 10),
  /** Whether async processing is enabled */
  enabled: process.env.MEMORY_PROCESSOR_ENABLED !== 'false',
},
```

---

### Step 5: Update Conversation Module

**Modify: `src/conversation.ts`**

Replace the entire file:

```typescript
/**
 * Conversation history management.
 *
 * Provides interface for conversation history storage.
 * Uses SQLite for persistence (survives server restarts).
 */

import { getConversationStore } from './services/conversation/index.js';

export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

const MAX_MESSAGES = 50;

/**
 * Get conversation history for a phone number.
 * Returns messages in chronological order (oldest first).
 */
export async function getHistory(phoneNumber: string): Promise<Message[]> {
  const store = getConversationStore();
  const messages = await store.getHistory(phoneNumber, { limit: MAX_MESSAGES });

  // Convert to simple Message format for backward compatibility
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * Add a message to conversation history.
 */
export async function addMessage(
  phoneNumber: string,
  role: 'user' | 'assistant',
  content: string,
  channel: 'sms' | 'whatsapp' = 'sms'
): Promise<void> {
  const store = getConversationStore();
  await store.addMessage(phoneNumber, role, content, channel);
}
```

**Note:** This changes `getHistory` and `addMessage` to be async. You'll need to update all callers to use `await`.

---

### Step 6: Update SMS Route

**Modify: `src/routes/sms.ts`**

Update the imports:

```typescript
import { getHistory, addMessage } from '../conversation.js';
// Remove: type Message (no longer needed from conversation.ts)
```

Update all `addMessage` calls to include channel and await:

```typescript
// Line ~221 (in main handler):
await addMessage(sender, 'user', message, channel);
await addMessage(sender, 'assistant', classification.immediateResponse, channel);

// Line ~127 (in processAsyncWork):
await addMessage(sender, 'assistant', responseText, channel);

// Lines ~266-267 (in error handler):
await addMessage(sender, 'user', message, channel);
await addMessage(sender, 'assistant', fallbackMessage, channel);
```

Update all `getHistory` calls to be awaited:

```typescript
// Line ~205:
const history = await getHistory(sender);

// Line ~243:
const updatedHistory = await getHistory(sender);

// Line ~275:
const history = await getHistory(sender);
```

Also need to update `processAsyncWork` signature to remove the `history` parameter since we'll fetch it inside:

```typescript
async function processAsyncWork(
  sender: string,
  message: string,
  channel: MessageChannel,
  userConfig: UserConfig | null
): Promise<void> {
  // Fetch history inside the function
  const history = await getHistory(sender);
  // ... rest of implementation
}
```

---

### Step 7: Create Memory Processor

**File: `src/services/memory/processor.ts`**

```typescript
/**
 * @fileoverview Async memory processor.
 *
 * Periodically processes conversation messages to extract
 * user facts for the memory system.
 */

import Anthropic from '@anthropic-ai/sdk';
import config from '../../config.js';
import { getConversationStore, type ConversationMessage } from '../conversation/index.js';
import { getMemoryStore, type UserFact } from './index.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export interface ProcessingError {
  phoneNumber: string;
  messageIds: string[];
  error: string;
}

export interface ProcessingResult {
  messagesProcessed: number;
  factsExtracted: number;
  errors: ProcessingError[];
}

interface ExtractedFact {
  fact: string;
  category?: string;
}

/**
 * Build the extraction prompt for the LLM.
 */
function buildExtractionPrompt(
  existingFacts: UserFact[],
  messages: ConversationMessage[]
): string {
  const existingFactsXml = existingFacts.length > 0
    ? existingFacts.map((f) => f.fact).join('\n')
    : '(No existing facts)';

  const messagesXml = messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n');

  return `You are analyzing conversation messages to extract persistent facts about the user.

<existing_facts>
${existingFactsXml}
</existing_facts>

<recent_messages>
${messagesXml}
</recent_messages>

Extract NEW facts from the messages that:
- Represent persistent information about the user (preferences, relationships, health, work, etc.)
- Are NOT already captured in <existing_facts>
- Are NOT temporary ("I'm busy today") or questions
- Are stated by the user (role: user), not the assistant

Return a JSON array of facts. Each fact should be an atomic sentence in third person (e.g., "Likes coffee", "Has a dog named Max").
[{"fact": "...", "category": "preferences|health|relationships|work|interests|other"}]

Return empty array [] if no new facts to extract.

IMPORTANT: Return ONLY the JSON array, no other text.`;
}

/**
 * Parse the LLM response to extract facts.
 */
function parseExtractedFacts(response: string): ExtractedFact[] {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is ExtractedFact =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.fact === 'string' &&
        item.fact.trim().length > 0
    );
  } catch {
    return [];
  }
}

/**
 * Check if a fact is a duplicate (case-insensitive).
 */
function isDuplicate(newFact: string, existingFacts: UserFact[]): boolean {
  const normalized = newFact.toLowerCase().trim();
  return existingFacts.some((f) => f.fact.toLowerCase().trim() === normalized);
}

/**
 * Process a batch of messages for a single user.
 */
async function processUserMessages(
  phoneNumber: string,
  messages: ConversationMessage[]
): Promise<{ factsExtracted: number; error?: string }> {
  const memoryStore = getMemoryStore();
  const existingFacts = await memoryStore.getFacts(phoneNumber);

  // Build and send extraction request
  const prompt = buildExtractionPrompt(existingFacts, messages);

  const response = await client.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract text from response
  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Parse extracted facts
  const extractedFacts = parseExtractedFacts(responseText);
  let factsExtracted = 0;

  // Store non-duplicate facts
  const now = Date.now();
  for (const extracted of extractedFacts) {
    if (!isDuplicate(extracted.fact, existingFacts)) {
      await memoryStore.addFact({
        phoneNumber,
        fact: extracted.fact,
        category: extracted.category,
        extractedAt: now,
      });
      factsExtracted++;

      // Add to existing facts to prevent duplicates within same batch
      existingFacts.push({
        id: '',
        phoneNumber,
        fact: extracted.fact,
        category: extracted.category,
        extractedAt: now,
      });
    }
  }

  return { factsExtracted };
}

/**
 * Process all unprocessed messages.
 * Groups messages by phone number for efficient batch processing.
 */
export async function processUnprocessedMessages(): Promise<ProcessingResult> {
  const conversationStore = getConversationStore();
  const batchSize = config.memoryProcessor.batchSize;

  // Get unprocessed user messages in FIFO order with per-user cap
  const messages = await conversationStore.getUnprocessedMessages({
    limit: batchSize,
    perUserLimit: config.memoryProcessor.perUserBatchSize,
  });

  if (messages.length === 0) {
    console.log(JSON.stringify({
      event: 'memory_processor_no_work',
      timestamp: new Date().toISOString(),
    }));
    return { messagesProcessed: 0, factsExtracted: 0, errors: [] };
  }

  console.log(JSON.stringify({
    event: 'memory_processor_start',
    messageCount: messages.length,
    timestamp: new Date().toISOString(),
  }));

  // Group messages by phone number
  const messagesByUser = new Map<string, ConversationMessage[]>();
  for (const message of messages) {
    const existing = messagesByUser.get(message.phoneNumber) || [];
    existing.push(message);
    messagesByUser.set(message.phoneNumber, existing);
  }

  const result: ProcessingResult = {
    messagesProcessed: 0,
    factsExtracted: 0,
    errors: [],
  };

  // Process each user's messages
  for (const [phoneNumber, userMessages] of messagesByUser) {
    const messageIds = userMessages.map((m) => m.id);

    try {
      const { factsExtracted } = await processUserMessages(phoneNumber, userMessages);

      // Mark messages as processed
      await conversationStore.markAsProcessed(messageIds);

      result.messagesProcessed += userMessages.length;
      result.factsExtracted += factsExtracted;

      console.log(JSON.stringify({
        event: 'memory_processor_user_complete',
        phoneNumberSuffix: phoneNumber.slice(-4),
        messagesProcessed: userMessages.length,
        factsExtracted,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(JSON.stringify({
        event: 'memory_processor_user_error',
        phoneNumberSuffix: phoneNumber.slice(-4),
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }));

      result.errors.push({
        phoneNumber,
        messageIds,
        error: errorMessage,
      });

      // Don't mark as processed - will retry next cycle
    }
  }

  console.log(JSON.stringify({
    event: 'memory_processor_complete',
    messagesProcessed: result.messagesProcessed,
    factsExtracted: result.factsExtracted,
    errorCount: result.errors.length,
    timestamp: new Date().toISOString(),
  }));

  return result;
}
```

---

### Step 8: Create Memory Processor Poller

**Add to: `src/services/memory/processor.ts`** (at the end of the file)

```typescript
import { createIntervalPoller, type Poller } from '../scheduler/poller.js';

let poller: Poller | null = null;

/**
 * Start the memory processor.
 * Runs periodically to extract facts from unprocessed messages.
 */
export function startMemoryProcessor(): void {
  if (!config.memoryProcessor.enabled) {
    console.log(JSON.stringify({
      event: 'memory_processor_disabled',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  if (poller) {
    console.log(JSON.stringify({
      event: 'memory_processor_already_running',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  poller = createIntervalPoller(
    processUnprocessedMessages,
    config.memoryProcessor.intervalMs
  );

  poller.start();

  console.log(JSON.stringify({
    event: 'memory_processor_started',
    intervalMs: config.memoryProcessor.intervalMs,
    batchSize: config.memoryProcessor.batchSize,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Stop the memory processor.
 */
export function stopMemoryProcessor(): void {
  if (poller) {
    poller.stop();
    poller = null;

    console.log(JSON.stringify({
      event: 'memory_processor_stopped',
      timestamp: new Date().toISOString(),
    }));
  }
}
```

---

### Step 9: Initialize in Application Entry

**Modify: `src/index.ts`**

Add imports:

```typescript
import { closeConversationStore } from './services/conversation/index.js';
import { startMemoryProcessor, stopMemoryProcessor } from './services/memory/processor.js';
```

After `poller.start()` (around line 81), add:

```typescript
// Start the memory processor
startMemoryProcessor();
```

Update the `shutdown` function:

```typescript
function shutdown(signal: string) {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Shutdown signal received',
      signal,
      timestamp: new Date().toISOString(),
    })
  );

  stopScheduler();
  stopMemoryProcessor();
  closeConversationStore();
  db.close();

  server.close(() => {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Server closed',
        timestamp: new Date().toISOString(),
      })
    );
    process.exit(0);
  });
}
```

---

### Step 10: Testing

**Unit Tests for Conversation Store:**

```typescript
// tests/services/conversation/sqlite.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConversationStore } from '../../../src/services/conversation/sqlite.js';
import fs from 'fs';

describe('SqliteConversationStore', () => {
  let store: SqliteConversationStore;
  const testDbPath = './data/test-conversation.db';

  beforeEach(() => {
    store = new SqliteConversationStore(testDbPath);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('should add and retrieve messages', async () => {
    await store.addMessage('+1234567890', 'user', 'Hello', 'sms');
    await store.addMessage('+1234567890', 'assistant', 'Hi there!', 'sms');

    const history = await store.getHistory('+1234567890');

    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
  });

  it('should filter by memoryProcessed status', async () => {
    await store.addMessage('+1234567890', 'user', 'Test 1', 'sms');
    await store.addMessage('+1234567890', 'user', 'Test 2', 'sms');

    const unprocessed = await store.getHistory('+1234567890', { memoryProcessed: false });

    expect(unprocessed).toHaveLength(2);
    expect(unprocessed[0].memoryProcessed).toBe(false);
  });

  it('should filter by time range', async () => {
    const before = Date.now();
    await store.addMessage('+1234567890', 'user', 'Test 1', 'sms');
    const middle = Date.now();
    await store.addMessage('+1234567890', 'user', 'Test 2', 'sms');

    const messagesSinceMiddle = await store.getHistory('+1234567890', { since: middle });

    expect(messagesSinceMiddle).toHaveLength(1);
    expect(messagesSinceMiddle[0].content).toBe('Test 2');
  });

  it('should get unprocessed messages across all users', async () => {
    await store.addMessage('+1111111111', 'user', 'User 1 msg', 'sms');
    await store.addMessage('+2222222222', 'user', 'User 2 msg', 'sms');

    // Get unprocessed for all users (no phoneNumber filter)
    const unprocessed = await store.getHistory(undefined, { memoryProcessed: false });

    expect(unprocessed).toHaveLength(2);
  });

  it('should mark messages as processed', async () => {
    const msg = await store.addMessage('+1234567890', 'user', 'Test', 'sms');

    await store.markAsProcessed([msg.id]);

    const unprocessed = await store.getHistory('+1234567890', { memoryProcessed: false });
    expect(unprocessed).toHaveLength(0);

    const processed = await store.getHistory('+1234567890', { memoryProcessed: true });
    expect(processed).toHaveLength(1);
  });

  it('should filter by role', async () => {
    await store.addMessage('+1234567890', 'user', 'Hello', 'sms');
    await store.addMessage('+1234567890', 'assistant', 'Hi!', 'sms');

    const userOnly = await store.getHistory('+1234567890', { role: 'user' });

    expect(userOnly).toHaveLength(1);
    expect(userOnly[0].role).toBe('user');
  });
});
```

**Manual Testing:**

1. Start the server with `MEMORY_PROCESSOR_INTERVAL_MS=60000` (1 minute for testing)
2. Send a few messages via SMS/WhatsApp that include personal information
3. Wait for the processor cycle (check logs for `memory_processor_complete`)
4. Send "what do you know about me?" to verify facts were extracted

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/services/conversation/types.ts` | Create | ConversationMessage, ConversationStore types |
| `src/services/conversation/sqlite.ts` | Create | SQLite implementation |
| `src/services/conversation/index.ts` | Create | Factory, singleton pattern |
| `src/services/memory/processor.ts` | Create | Async extraction logic + poller |
| `src/conversation.ts` | Modify | Delegate to SQLite store, make async |
| `src/config.ts` | Modify | Add conversation + memoryProcessor config |
| `src/routes/sms.ts` | Modify | Pass channel, await async calls |
| `src/index.ts` | Modify | Initialize store, start/stop processor |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONVERSATION_DB_PATH` | `./data/conversation.db` | Path to conversation SQLite database |
| `MEMORY_PROCESSOR_INTERVAL_MS` | `300000` (5 min) | How often to run memory extraction |
| `MEMORY_PROCESSOR_BATCH_SIZE` | `100` | Max messages to process per run |
| `MEMORY_PROCESSOR_PER_USER_BATCH_SIZE` | `25` | Max messages per user per run |
| `MEMORY_PROCESSOR_ENABLED` | `true` | Set to `false` to disable async processing |

---

## Rollback

Set `MEMORY_PROCESSOR_ENABLED=false` to disable async processing. Sync memory tools continue working. Message persistence remains (useful for debugging).

## Future Scaling Note

This plan assumes a single running instance. If you later add multiple workers, add a lightweight lease/reservation mechanism to prevent double-processing (e.g., mark rows as "in progress" with a timeout before invoking the LLM).
