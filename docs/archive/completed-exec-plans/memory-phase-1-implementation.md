# Memory System - Phase 1 Implementation Plan

**Version**: 1.0
**Date**: 2026-01-23
**Reference**: [Memory PRD](17-memory-prd.md)

---

## Overview

This document provides a detailed, step-by-step implementation plan for Phase 1 of the memory system. Each step is designed to be a small, isolated task that can be implemented and tested independently.

**Key Principles:**
- Keep it simple - no over-engineering
- Separate refactoring from behavior changes
- Each step should be testable as a unit
- Follow existing codebase patterns (user-config service as reference)

**About Code Examples:**
- Full TypeScript code is provided for clarity and as implementation reference
- Code examples follow existing patterns in the codebase
- Adapt as needed for your specific implementation
- Focus on the logic and flow; specific implementations may vary

---

## Prerequisites

Before starting, ensure you're familiar with:
- [Memory PRD](17-memory-prd.md) - Product requirements
- [AGENTS.md](../AGENTS.md) - Project coding guidelines
- Existing `user-config` service pattern (`src/services/user-config/`)

---

## Implementation Steps

### Step 1: Create Memory Service Types

**File**: `src/services/memory/types.ts`

**Goal**: Define TypeScript interfaces for memory storage

**Tasks:**
1. Create `UserFact` interface matching PRD schema
2. Create `MemoryStore` interface with CRUD methods
3. Keep it minimal - only what's needed for Phase 1

**Interface Design:**
```typescript
export interface UserFact {
  id: string;
  phoneNumber: string;
  fact: string;              // Atomic sentence: "Likes black coffee"
  category?: string;         // Optional: "preferences", "health", etc.
  extractedAt: number;       // Unix timestamp (milliseconds)
  // Phase 2: embedding?: Float32Array;
}

export interface MemoryStore {
  // Get all facts for a user
  getFacts(phoneNumber: string): Promise<UserFact[]>;

  // Add a new fact
  addFact(fact: Omit<UserFact, 'id'>): Promise<UserFact>;

  // Update an existing fact
  updateFact(id: string, updates: Partial<Omit<UserFact, 'id' | 'phoneNumber'>>): Promise<void>;

  // Delete a fact
  deleteFact(id: string): Promise<void>;
}
```

**Testing:**
- Compile check: `npm run build`
- Type correctness verified by TypeScript

**Notes:**
- No embedding field yet (Phase 2)
- Follow existing `UserConfig` pattern in `user-config/types.ts`

---

### Step 2: Create SQLite Memory Store

**File**: `src/services/memory/sqlite.ts`

**Goal**: Implement MemoryStore using SQLite (following user-config pattern)

**Tasks:**
1. Create `SqliteMemoryStore` class implementing `MemoryStore`
2. Initialize schema in constructor with `user_facts` table
3. Implement all CRUD methods
4. Use `better-sqlite3` (already a dependency)

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS user_facts (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  fact TEXT NOT NULL,
  category TEXT,
  extracted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_facts_phone ON user_facts(phone_number);
```

**Implementation Pattern:**
```typescript
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { MemoryStore, UserFact } from './types.js';

export class SqliteMemoryStore implements MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Same pattern as SqliteUserConfigStore
    // - Ensure directory exists
    // - Create database
    // - Initialize schema
  }

  private initSchema(): void {
    // Create table + index
  }

  async getFacts(phoneNumber: string): Promise<UserFact[]> {
    // Query all facts, order by extractedAt DESC
  }

  async addFact(fact: Omit<UserFact, 'id'>): Promise<UserFact> {
    // Generate UUID, insert, return with ID
  }

  async updateFact(id: string, updates: Partial<Omit<UserFact, 'id' | 'phoneNumber'>>): Promise<void> {
    // Build dynamic UPDATE query like user-config does
  }

  async deleteFact(id: string): Promise<void> {
    // DELETE by id
  }

  close(): void {
    // Close database connection
  }
}
```

**Testing:**
- Unit test: Create in-memory DB (`:memory:`), test basic CRUD operations
- See Testing Strategy section for details

**Notes:**
- Database file: `data/memory.db` (same directory as other DBs)
- Follow exact pattern from `user-config/sqlite.ts`

---

### Step 3: Create Memory Service Barrel Export

**File**: `src/services/memory/index.ts`

**Goal**: Provide singleton instance of memory store (following user-config pattern)

**Tasks:**
1. Create singleton instance
2. Export store and types
3. Match `user-config/index.ts` pattern

**Implementation:**
```typescript
import path from 'path';
import { SqliteMemoryStore } from './sqlite.js';
import config from '../../config.js';

// Singleton instance
let memoryStore: SqliteMemoryStore | null = null;

export function getMemoryStore(): SqliteMemoryStore {
  if (!memoryStore) {
    const dbPath = path.join(config.dataDir, 'memory.db');
    memoryStore = new SqliteMemoryStore(dbPath);
  }
  return memoryStore;
}

// Re-export types
export type { UserFact, MemoryStore } from './types.js';
```

**Testing:**
- Import in a test file and call `getMemoryStore()`
- Verify singleton pattern (same instance on multiple calls)

**Notes:**
- Assumes `config.dataDir` exists (matches existing pattern)

---

### Step 4: Memory Deletion via Remove Tool

**Note**: Memory facts are deleted individually via the `remove_memory` tool (Step 9c).

**Rationale**:
- User config (name, timezone) and memory (facts) are separate concerns
- `delete_user_data` handles config deletion
- Memory deletion is explicit via `remove_memory` tool
- Users maintain control over what memories to delete

**No code changes needed for this step.**

---

### Step 5: Add Fact Extraction Tool

**File**: `src/llm.ts` (add new tool to TOOLS array)

**Goal**: Allow LLM to extract and store facts from conversations

**Tasks:**
1. Define `extract_memory` tool in TOOLS array
2. Implement tool handler
3. Keep extraction simple - LLM does the work

**Tool Definition:**
```typescript
{
  name: 'extract_memory',
  description: `Extract and store facts about the user from the conversation.

Use this when the user shares information about themselves that should be remembered:
- Personal details (name already handled by set_user_config, but other details)
- Preferences (food, communication style, etc.)
- Relationships (family, pets, colleagues)
- Health information (allergies, conditions)
- Work/life context (job, hobbies, routines)

Extract facts as atomic, self-contained sentences. Examples:
- "Likes black coffee"
- "Allergic to peanuts"
- "Has a dog named Max"
- "Works as software engineer"

IMPORTANT - Check <user_memory><facts> BEFORE extracting:
- Don't extract facts already present in memory
- Consider semantic equivalence: "Likes coffee" = "Prefers coffee" = "Drinks coffee"
- If fact exists with slight variation, skip it (don't extract duplicate)

Don't extract:
- Temporary information ("I'm busy today")
- Questions ("Should I...?")
- Facts already stored in <user_memory>`,
  input_schema: {
    type: 'object' as const,
    properties: {
      facts: {
        type: 'array',
        description: 'Array of facts to extract. Each fact should be a simple, atomic sentence.',
        items: {
          type: 'object',
          properties: {
            fact: {
              type: 'string',
              description: 'The fact as a concise sentence',
            },
            category: {
              type: 'string',
              description: 'Optional category: preferences, health, relationships, work, interests, etc.',
            },
          },
          required: ['fact'],
        },
      },
    },
    required: ['facts'],
  },
}
```

**Tool Handler:**
```typescript
if (toolName === 'extract_memory') {
  if (!phoneNumber) {
    return JSON.stringify({ success: false, error: 'Phone number not available' });
  }

  const { facts } = toolInput as {
    facts: Array<{
      fact: string;
      category?: string;
    }>;
  };

  try {
    const memoryStore = getMemoryStore();
    const now = Date.now();
    const addedFacts: UserFact[] = [];

    // Get existing facts for backup duplicate detection
    // Note: Primary duplicate detection is LLM-based (via tool instructions)
    // LLM sees all facts in <user_memory> and is instructed not to extract duplicates
    // This is a backup safety check for exact matches only
    const existingFacts = await memoryStore.getFacts(phoneNumber);

    for (const factInput of facts) {
      // Backup duplicate detection: exact match, case-insensitive, trimmed
      // Catches obvious duplicates that slip through LLM instructions
      const isDuplicate = existingFacts.some(
        existing => existing.fact.toLowerCase().trim() === factInput.fact.toLowerCase().trim()
      );

      if (isDuplicate) {
        console.log(JSON.stringify({
          level: 'info',
          message: 'Skipping duplicate fact (exact match)',
          fact: factInput.fact,
          timestamp: new Date().toISOString(),
        }));
        continue; // Skip this fact
      }

      const fact = await memoryStore.addFact({
        phoneNumber,
        fact: factInput.fact,
        category: factInput.category,
        extractedAt: now,
      });
      addedFacts.push(fact);
    }

    console.log(JSON.stringify({
      level: 'info',
      message: 'Facts extracted',
      count: addedFacts.length,
      timestamp: new Date().toISOString(),
    }));

    return JSON.stringify({
      success: true,
      extracted_count: addedFacts.length,
      facts: addedFacts.map(f => ({ id: f.id, fact: f.fact })),
      memory_updated: addedFacts.length > 0, // Signal memory reload needed
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to extract memory',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

**Testing:**
- Test extraction with mock conversation
- Verify facts are stored in database
- Test with different confidence levels and categories

**Notes:**
- LLM decides WHEN to extract (not every message)
- LLM decides WHAT to extract (fact granularity)
- This is explicit extraction - user must share info
- Duplicate detection strategy:
  - Primary: LLM sees existing facts in `<user_memory>` and is instructed not to extract duplicates
  - Backup: Code checks for exact case-insensitive matches as safety net
  - Phase 2: Add embedding-based semantic similarity for robust detection

---

### Step 6: Build Memory XML Context

**File**: `src/llm.ts` (add new helper function)

**Goal**: Generate XML memory block from stored facts

**Tasks:**
1. Create `buildMemoryXml` function
2. Query facts from memory store
3. Format as Letta-style XML

**Implementation:**
```typescript
/**
 * Build memory XML block from stored facts.
 */
async function buildMemoryXml(phoneNumber: string): Promise<string> {
  const memoryStore = getMemoryStore();
  const facts = await memoryStore.getFacts(phoneNumber);

  if (facts.length === 0) {
    return ''; // No memory to inject
  }

  // Join facts into plain text
  const factsText = facts.map(f => f.fact).join('. ') + '.';

  return `

<user_memory>
  <facts>
    ${factsText}
  </facts>
</user_memory>`;
}
```

**Testing:**
- Manual verification: Print output with test facts
- Integration tests will catch XML issues

**Notes:**
- Facts are joined with `. ` as separator
- Add trailing period if not present
- No line breaks within facts (keep it compact)

---

### Step 7: Integrate Memory into System Prompt

**File**: `src/llm.ts` (modify `buildUserContext` and `generateResponse`)

**Goal**: Inject memory XML into system prompt

**Tasks:**
1. Modify `buildUserContext` to accept optional memory XML
2. Update call sites to include memory
3. Keep profile and facts separate

**Refactor `buildUserContext`:**
```typescript
/**
 * Build user context section for system prompt.
 * Includes profile (name/timezone) and optionally memory (facts).
 */
function buildUserContext(userConfig: UserConfig | null, memoryXml?: string): string {
  const timezone = userConfig?.timezone || null;
  const name = userConfig?.name || null;
  const timeContext = buildTimeContext(userConfig);

  // Build missing fields prompt
  const missingFields: string[] = [];
  if (!name) missingFields.push('name');
  if (!timezone) missingFields.push('timezone');

  let setupPrompt = '';
  if (missingFields.length > 0) {
    setupPrompt = `\n\n**Setup needed:** This user hasn't set up their profile yet. Missing: ${missingFields.join(', ')}.
Naturally ask for this info in your response. Be conversational:
- "Hey! I don't think we've met - what should I call you?"
- "By the way, what timezone are you in so I can get times right for you?"
Don't block their request - help them AND ask for the missing info.`;
  }

  // Build profile XML
  let profileXml = '\n\n<user_memory>\n  <profile>\n';
  if (name) profileXml += `    <name>${name}</name>\n`;
  if (timezone) profileXml += `    <timezone>${timezone}</timezone>\n`;
  profileXml += '  </profile>';

  // Add facts if provided
  if (memoryXml) {
    // memoryXml already contains </user_memory> closing tag
    return `\n\n## User Context
- Name: ${name || 'not set'}
- Timezone: ${timezone || 'not set'}
- ${timeContext}${setupPrompt}

${profileXml}
${memoryXml}`;
  }

  // No facts - close user_memory tag
  return `\n\n## User Context
- Name: ${name || 'not set'}
- Timezone: ${timezone || 'not set'}
- ${timeContext}${setupPrompt}

${profileXml}
</user_memory>`;
}
```

**Update `generateResponse`:**
```typescript
export async function generateResponse(
  userMessage: string,
  conversationHistory: Message[],
  phoneNumber?: string,
  userConfig?: UserConfig | null,
  options?: GenerateOptions
): Promise<string> {
  const anthropic = getClient();

  // Convert history to Anthropic format
  const messages: MessageParam[] = conversationHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  // Build memory XML if phone number available
  let memoryXml: string | undefined;
  if (phoneNumber) {
    memoryXml = await buildMemoryXml(phoneNumber);
  }

  // Build system prompt - use provided or build default with user context and memory
  const timeContext = buildTimeContext(userConfig ?? null);
  const systemPrompt = options?.systemPrompt
    ?? (`**${timeContext}**\n\n` + SYSTEM_PROMPT + buildUserContext(userConfig ?? null, memoryXml));

  // ... rest of existing code unchanged ...
}
```

**Testing:**
- Manual verification: Print system prompt with test facts
- Integration tests will verify end-to-end behavior

**Notes:**
- This is the critical integration point
- Memory is loaded once at request start
- Memory appears in system prompt, not user messages
- Will be reloaded mid-conversation if extract_memory is called (see Step 7b)

---

### Step 7b: Reload Memory in Tool Loop

**File**: `src/llm.ts` (modify `generateResponse` tool loop)

**Goal**: Make extracted facts immediately visible in the same conversation

**Tasks:**
1. Detect when memory has been updated via tool result
2. Reload memory XML from database
3. Rebuild system prompt with updated memory
4. Continue tool loop with fresh memory

**Implementation:**

Modify the tool loop in `generateResponse`:

```typescript
// Handle tool use loop
let loopCount = 0;
const MAX_TOOL_LOOPS = 5;

while (response.stop_reason === 'tool_use') {
  loopCount++;

  if (loopCount > MAX_TOOL_LOOPS) {
    console.warn(/* ... */);
    break;
  }

  console.log(/* ... tool use loop ... */);

  const toolUseBlocks = response.content.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use'
  );

  // Process all tool calls
  const toolResults: ToolResultBlockParam[] = await Promise.all(
    toolUseBlocks.map(async (toolUse) => {
      const result = await handleToolCall(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        phoneNumber,
        options
      );
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUse.id,
        content: result,
      };
    })
  );

  // Check if any tool updated memory
  let memoryWasUpdated = false;
  for (const toolResult of toolResults) {
    try {
      const parsed = JSON.parse(toolResult.content as string);
      if (parsed.memory_updated === true) {
        memoryWasUpdated = true;
        break;
      }
    } catch {
      // Not JSON or doesn't have memory_updated - skip
    }
  }

  // Reload memory if updated
  if (memoryWasUpdated && phoneNumber) {
    console.log(JSON.stringify({
      level: 'info',
      message: 'Memory updated, reloading',
      timestamp: new Date().toISOString(),
    }));

    memoryXml = await buildMemoryXml(phoneNumber);
    const timeContext = buildTimeContext(userConfig ?? null);
    systemPrompt = options?.systemPrompt
      ?? (`**${timeContext}**\n\n` + SYSTEM_PROMPT + buildUserContext(userConfig ?? null, memoryXml));
  }

  // Add assistant response and tool results to messages
  messages.push({ role: 'assistant', content: response.content });
  messages.push({ role: 'user', content: toolResults });

  // Continue the conversation with updated system prompt
  console.log(/* ... continuing conversation ... */);

  response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt, // Now includes fresh memory!
    tools,
    messages,
  });

  console.log(/* ... response after tool ... */);
}
```

**Testing:**
- Extract fact mid-conversation
- Verify memory XML reloads
- Verify agent can see fact immediately
- Test: "I have a dog named Max" → "What's my dog's name?" (should work in same conversation)

**Notes:**
- Memory reload only happens when `memory_updated: true` in tool result
- System prompt is rebuilt with fresh memory
- Agent sees updated facts immediately in next turn
- This matches Letta's behavior (immediate visibility)

---

### Step 8: Update System Prompt Instructions

**File**: `src/llm.ts` (modify `SYSTEM_PROMPT`)

**Goal**: Instruct Claude how to use memory

**Tasks:**
1. Add section about memory system
2. Explain when to extract facts
3. Explain that memory is in `<user_memory>` section

**Add to SYSTEM_PROMPT** (after "User Context" section, before tools):
```typescript
const SYSTEM_PROMPT = `You are a helpful SMS assistant. Keep responses concise since you communicate via SMS. Be direct and helpful.

When it fits naturally, include a relevant emoji to make responses more visually engaging (e.g., 📅 for calendar, ✅ for confirmations, 🛒 for shopping). Don't force it—skip emojis for simple or serious responses.

## Memory System

You have access to information about the user in the <user_memory> section. This includes:
- Profile: Name and timezone (set via set_user_config tool)
- Facts: Things the user has told you about themselves

Use this information to personalize your responses. For example:
- If you know they're allergic to peanuts, don't suggest recipes with peanuts
- If you know they have a dog named Max, you can ask about Max
- If you know they prefer brief responses, keep it short

**Extracting new facts:**
When the user shares NEW information about themselves that should be remembered, use the extract_memory tool. Examples:
- "I love black coffee" → Extract: "Likes black coffee"
- "I have a dog named Max" → Extract: "Has a dog named Max"
- "I'm allergic to peanuts" → Extract: "Allergic to peanuts"

Don't extract:
- Temporary information ("I'm busy today", "I have a headache")
- Information already in <user_memory>
- Questions or requests

Be conservative with extraction - only extract clear, persistent facts that would be useful in future conversations.

## UI Generation Capability
// ... rest of existing prompt ...
`;
```

**Testing:**
- Have Claude read a conversation with fact sharing
- Verify it calls `extract_memory` appropriately
- Verify it uses facts from `<user_memory>` in responses

**Notes:**
- This guides Claude's behavior
- Extraction is opportunistic, not forced
- Keep instructions clear and concise

---

### Step 9a: Add list_memories Tool

**File**: `src/llm.ts` (add tool to TOOLS array)

**Goal**: Let users view what facts have been stored

**Tasks:**
1. Add `list_memories` tool definition
2. Implement tool handler
3. Return facts with IDs for transparency

**Tool Definition:**
```typescript
{
  name: 'list_memories',
  description: 'Show what facts the assistant has remembered about the user. Use when user asks "what do you know about me", "show my facts", or "what have you remembered".',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
}
```

**Tool Handler:**
```typescript
if (toolName === 'list_memories') {
  if (!phoneNumber) {
    return JSON.stringify({ success: false, error: 'Phone number not available' });
  }

  try {
    const memoryStore = getMemoryStore();
    const facts = await memoryStore.getFacts(phoneNumber);

    if (facts.length === 0) {
      return JSON.stringify({
        success: true,
        count: 0,
        message: 'No memories stored yet.',
      });
    }

    const factList = facts.map(f => ({
      id: f.id,
      fact: f.fact,
      category: f.category || 'uncategorized',
      extractedAt: new Date(f.extractedAt).toLocaleString('en-US', {
        timeZone: userConfig?.timezone || 'UTC',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    }));

    return JSON.stringify({
      success: true,
      count: facts.length,
      facts: factList,
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to list memories',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

**Testing:**
- Extract some facts
- Call `list_memories` and verify output
- Verify facts include IDs, categories, timestamps

**Notes:**
- Read-only operation (no memory_updated flag needed)
- Useful for debugging and transparency
- User can see what the assistant knows

---

### Step 9b: Add update_memory Tool

**File**: `src/llm.ts` (add tool to TOOLS array)

**Goal**: Allow agent to update existing facts when user provides corrections

**Tasks:**
1. Add `update_memory` tool definition
2. Implement tool handler with memory reload
3. Support updating fact text or category

**Tool Definition:**
```typescript
{
  name: 'update_memory',
  description: 'Update an existing fact about the user when they correct or clarify something. Use when user says "Actually...", "I meant...", or provides new information that contradicts existing memory.',
  input_schema: {
    type: 'object' as const,
    properties: {
      fact_id: {
        type: 'string',
        description: 'The ID of the fact to update (from list_memories)',
      },
      new_fact: {
        type: 'string',
        description: 'The updated fact text (optional)',
      },
      category: {
        type: 'string',
        description: 'Updated category (optional)',
      },
    },
    required: ['fact_id'],
  },
}
```

**Tool Handler:**
```typescript
if (toolName === 'update_memory') {
  if (!phoneNumber) {
    return JSON.stringify({ success: false, error: 'Phone number not available' });
  }

  const { fact_id, new_fact, category } = toolInput as {
    fact_id: string;
    new_fact?: string;
    category?: string;
  };

  try {
    const memoryStore = getMemoryStore();

    const updates: Partial<Omit<UserFact, 'id' | 'phoneNumber'>> = {};
    if (new_fact !== undefined) updates.fact = new_fact;
    if (category !== undefined) updates.category = category;

    await memoryStore.updateFact(fact_id, updates);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Fact updated',
      factId: fact_id,
      updates: Object.keys(updates),
      timestamp: new Date().toISOString(),
    }));

    return JSON.stringify({
      success: true,
      fact_id,
      updated_fields: Object.keys(updates),
      memory_updated: true, // Signal memory reload needed
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to update memory',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

**Testing:**
- Extract a fact: "Likes coffee"
- List memories to get fact ID
- Update: "Actually, I prefer tea"
- Verify fact updated in database
- Verify memory reloads in same conversation

**Notes:**
- Returns `memory_updated: true` to trigger reload
- Supports partial updates (only update fields provided)
- Useful for corrections and clarifications

---

### Step 9c: Add remove_memory Tool

**File**: `src/llm.ts` (add tool to TOOLS array)

**Goal**: Allow agent to remove facts when user asks to forget something

**Tasks:**
1. Add `remove_memory` tool definition
2. Implement tool handler with memory reload
3. Support batch deletion

**Tool Definition:**
```typescript
{
  name: 'remove_memory',
  description: 'Remove specific facts about the user when they ask to forget something. Use when user says "forget that", "delete that fact", or "don\'t remember X anymore".',
  input_schema: {
    type: 'object' as const,
    properties: {
      fact_ids: {
        type: 'array',
        description: 'IDs of facts to delete (from list_memories)',
        items: { type: 'string' },
      },
    },
    required: ['fact_ids'],
  },
}
```

**Tool Handler:**
```typescript
if (toolName === 'remove_memory') {
  if (!phoneNumber) {
    return JSON.stringify({ success: false, error: 'Phone number not available' });
  }

  const { fact_ids } = toolInput as { fact_ids: string[] };

  try {
    const memoryStore = getMemoryStore();

    for (const id of fact_ids) {
      await memoryStore.deleteFact(id);
    }

    console.log(JSON.stringify({
      level: 'info',
      message: 'Facts deleted',
      count: fact_ids.length,
      timestamp: new Date().toISOString(),
    }));

    return JSON.stringify({
      success: true,
      deleted_count: fact_ids.length,
      memory_updated: fact_ids.length > 0, // Signal memory reload needed
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to delete memories',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

**Testing:**
- Extract some facts
- List memories to get fact IDs
- Remove one or more facts
- Verify facts are deleted
- Verify memory reloads in same conversation

**Notes:**
- Returns `memory_updated: true` to trigger reload
- Supports batch deletion (multiple fact IDs)
- Permanent deletion (no undo)

---

## Testing Strategy

**Philosophy**: Focus on major cases. Don't over-test implementation details.

### Unit Test: `tests/unit/memory-sqlite.test.ts`

Test basic CRUD operations (following `credentials-sqlite.test.ts` pattern):

```typescript
describe('SqliteMemoryStore', () => {
  it('stores and retrieves facts');
  it('updates existing fact');
  it('deletes fact');
  it('handles non-existent fact ID gracefully');
});
```

**Skip**: Empty result tests, timestamp validation, XML validation (covered by integration)

### Integration Test: `tests/integration/memory.test.ts`

Test end-to-end flow only:

```typescript
describe('Memory Integration', () => {
  it('extracts, stores, and uses facts in conversation');
  it('removes facts via tool');
});
```

**Skip**: Tool-by-tool testing, XML structure validation, duplicate detection edge cases

### Manual Testing (Most Important)

**Real SMS conversation:**
1. Share personal info: "I have a dog named Max"
2. Verify extraction happens automatically
3. Ask related question: "What's my dog's name?"
4. Verify response uses memory
5. Test memory management: "what do you know about me?"
6. Delete a fact, verify it's gone

---

## Rollout Plan

### Phase 1a: Foundation (Steps 1-3)
**Duration**: 1-2 hours
**Goal**: Memory service exists, no integration

- Create types
- Create SQLite store
- Create barrel export
- Test in isolation

**Validation**: Can create/read/update/delete facts programmatically

---

### Phase 1b: Extraction Tool (Step 5)
**Duration**: 1 hour
**Goal**: LLM can extract facts with duplicate detection

- Add `extract_memory` tool with duplicate detection
- Add `memory_updated` flag for reload signaling
- Test extraction manually

**Validation**: Can call tool, facts are stored, duplicates are skipped

---

### Phase 1c: Memory Injection (Steps 6-7)
**Duration**: 1-2 hours
**Goal**: Memory appears in system prompt

- Build memory XML
- Integrate into system prompt
- Add memory reload in tool loop (Step 7b)
- Test with real conversations

**Validation**: Facts appear in `<user_memory>` section and are immediately visible after extraction

---

### Phase 1d: Prompt Updates (Step 8)
**Duration**: 20 minutes
**Goal**: Claude knows how to use memory

- Update system prompt with memory instructions
- Test behavior

**Validation**: Claude extracts facts appropriately and uses them

---

### Phase 1e: Management Tools (Steps 9a-c)
**Duration**: 2 hours
**Goal**: Users can view/update/remove facts

- Add `list_memories` tool (Step 9a)
- Add `update_memory` tool (Step 9b)
- Add `remove_memory` tool (Step 9c)
- Test via SMS

**Validation**: Users can see, update, and remove facts with immediate effect

---

## Success Criteria

Phase 1 is complete when:

1. ✅ Memory service exists with CRUD operations
2. ✅ Facts are extracted automatically from conversations
3. ✅ Duplicate facts are detected and skipped
4. ✅ Facts appear in system prompt as XML
5. ✅ Extracted facts are immediately visible in same conversation (memory reload)
6. ✅ Claude uses facts to personalize responses
7. ✅ Users can list all stored facts
8. ✅ Users can update incorrect facts
9. ✅ Users can remove unwanted facts
10. ✅ All tests pass
11. ✅ Manual SMS testing validates behavior

---

## Troubleshooting

### Common Issues

**Problem**: Facts not extracted
- Check: Is `extract_memory` in TOOLS array?
- Check: Is tool handler implemented?
- Check: Are logs showing tool calls?

**Problem**: Facts not appearing in responses
- Check: Is `buildMemoryXml` returning correct XML?
- Check: Is memory XML added to system prompt?
- Check: Print system prompt to verify structure

**Problem**: Database errors
- Check: Is `data/` directory writable?
- Check: Is SQLite initialized correctly?
- Check: Are migrations needed?

**Problem**: XML parsing issues
- Check: Are special characters escaped?
- Check: Is XML well-formed?
- Use XML validator

---

## Future Enhancements (Phase 2+)

Not part of Phase 1, but keep in mind:

1. **Semantic Search**
   - Add embeddings to facts
   - Retrieve top-K relevant facts instead of all
   - Use when fact count > 20-30

2. **Fact Deduplication**
   - Detect duplicate facts before inserting
   - Merge similar facts
   - Update existing facts instead of creating duplicates

3. **Fact Confidence Decay**
   - Lower confidence for old, unmentioned facts
   - Archive or delete low-confidence facts

4. **Episodic Memory**
   - Store conversation summaries
   - Retrieve relevant episodes via semantic search

5. **Procedural Memory**
   - Learn interaction patterns
   - Store user preferences for how to interact

---

## References

- [Memory PRD](17-memory-prd.md) - Product requirements
- [AGENTS.md](../AGENTS.md) - Coding guidelines
- [Letta Documentation](https://docs.letta.com/guides/agents/memory-blocks) - Memory block inspiration
- Existing `user-config` service - Implementation reference

---

## Checklist

Before considering Phase 1 complete:

```
[ ] Step 1: Memory types created
[ ] Step 2: SQLite store implemented
[ ] Step 3: Barrel export working
[ ] Step 5: Extraction tool added (with LLM-based duplicate detection + backup exact match)
[ ] Step 6: Memory XML builder working
[ ] Step 7: Memory in system prompt
[ ] Step 7b: Memory reload in tool loop implemented
[ ] Step 8: System prompt updated with memory instructions
[ ] Step 9a: list_memories tool added
[ ] Step 9b: update_memory tool added
[ ] Step 9c: remove_memory tool added
[ ] Duplicate detection working (LLM instruction-based + exact match backup)
[ ] Memory immediately visible after extraction
[ ] All unit tests pass
[ ] All integration tests pass
[ ] Manual SMS testing successful (extract → immediate use in same conversation)
[ ] Code reviewed
[ ] Documentation updated
```
