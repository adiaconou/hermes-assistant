# Memory System Architecture

This document maps the complete architecture of the Hermes Assistant memory system.

## Overview

The memory system provides persistent semantic memory of user facts, enabling personalized conversations across sessions. It uses a dual-extraction approach: background async processing for low-latency conversations, and explicit user requests for immediate feedback.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MEMORY SYSTEM OVERVIEW                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User Message ──► Orchestrator ──► Agent(s) ──► Response Composer          │
│        │                │                              │                    │
│        │                ▼                              ▼                    │
│        │         Load user facts              Inject facts for              │
│        │         (injected into               personalized response         │
│        │          system prompt)                                            │
│        │                                                                    │
│        ▼                                                                    │
│   Conversation Store ◄───────────────────────────────────────┐              │
│        │                                                     │              │
│        │ (unprocessed messages)                              │              │
│        ▼                                                     │              │
│   Memory Processor ──► Claude Opus 4.5 ──► Extracted Facts   │              │
│   (async, every 5min)        │                    │          │              │
│                              │                    ▼          │              │
│                              │             SQLite Memory ────┘              │
│                              │                  Store                       │
│                              │                    ▲                         │
│                              │                    │                         │
│                              ▼                    │                         │
│                        Memory Agent ──────────────┘                         │
│                     (explicit requests)                                     │
│                              │                                              │
│                              ▼                                              │
│                         Admin UI                                            │
│                    (view/delete facts)                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Data Model

**Location:** [src/services/memory/types.ts](src/services/memory/types.ts)

```typescript
interface UserFact {
  id: string;                           // UUID identifier
  phoneNumber: string;                  // User identifier (multi-user support)
  fact: string;                         // Atomic fact text (e.g., "Likes black coffee")
  category?: string;                    // Optional categorization
  confidence: number;                   // 0.3-1.0 confidence score (clamped)
  sourceType: 'explicit' | 'inferred';  // Explicit user statement vs inferred
  evidence?: string;                    // Supporting snippet (max 120 chars)
  lastReinforcedAt?: number;            // Unix timestamp (ms) when last reinforced
  extractedAt: number;                  // Unix timestamp (ms) when first extracted
}
```

**Categories:** `preferences`, `health`, `relationships`, `work`, `interests`, `personal`, `recurring`, `behavioral`, `context`, `other`

**Confidence Scoring:**
- **1.0** - Explicitly stated by user via memory tool
- **0.8-0.9** - Directly stated in conversation
- **0.6-0.7** - Inferred from multiple data points
- **0.3-0.5** - Single observation or weak inference
- Values are clamped to 0.3-1.0 range

**Source Types:**
- `explicit` - User directly stated the fact
- `inferred` - Derived from conversation context

### 2. Storage Layer

**Location:** [src/services/memory/sqlite.ts](src/services/memory/sqlite.ts)

SQLite-based persistent storage using `better-sqlite3`.

**Schema:**
```sql
CREATE TABLE user_facts (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  fact TEXT NOT NULL,
  category TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_type TEXT NOT NULL DEFAULT 'explicit',
  evidence TEXT,
  last_reinforced_at INTEGER,
  extracted_at INTEGER NOT NULL
);

CREATE INDEX idx_user_facts_phone ON user_facts(phone_number);
```

**Database Path:** `./data/memory.db` (dev) or `/app/data/memory.db` (Railway production)

**Stale Observation Cleanup:**
- Facts with confidence < 0.6 and older than 180 days are auto-deleted
- Helps maintain relevant, high-quality memory

### 3. Memory Store Interface

**Location:** [src/services/memory/index.ts](src/services/memory/index.ts)

Singleton factory pattern providing CRUD operations:

| Method | Description |
|--------|-------------|
| `getFacts(phoneNumber)` | Retrieve all facts for a user |
| `getAllFacts()` | Retrieve all facts (admin use) |
| `addFact(fact)` | Create new fact (returns with generated ID) |
| `updateFact(id, updates)` | Partial update of existing fact |
| `deleteFact(id)` | Permanently remove a fact |
| `deleteStaleObservations()` | Remove old low-confidence facts |

---

## Fact Ranking and Selection

**Location:** [src/services/memory/ranking.ts](src/services/memory/ranking.ts)

Intelligent fact selection for context injection with character limits.

**Constants:**
```typescript
const DEFAULT_FACT_CHAR_CAP = 4000;           // Default context window cap
const ESTABLISHED_CONFIDENCE_THRESHOLD = 0.6;  // High confidence cutoff
```

**Selection Logic:**
1. Split facts into established (≥0.6) and observations (<0.6)
2. Sort each group by confidence (desc), then recency (desc)
3. Add facts until character limit reached
4. Prioritize established facts over observations

**Functions:**
- `clampConfidence(value)` - Ensures confidence in 0.3-1.0 range
- `sortFactsByConfidenceAndRecency(facts)` - Sort for display/selection
- `selectFactsWithCharCap(facts, render, options)` - Select facts under char limit

---

## Extraction Pipeline

### Background Processor

**Location:** [src/services/memory/processor.ts](src/services/memory/processor.ts)

Async background process that extracts facts from conversations.

```
┌──────────────────────────────────────────────────────────────────────┐
│                    BACKGROUND EXTRACTION FLOW                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   1. Poll Interval (every 5 min)                                     │
│            │                                                          │
│            ▼                                                          │
│   2. Get unprocessed messages from ConversationStore                 │
│      - FIFO order (oldest first)                                     │
│      - Max 100 total, max 25 per user                                │
│      - Includes assistant summaries (tool results)                   │
│            │                                                          │
│            ▼                                                          │
│   3. Group messages by phone number                                  │
│            │                                                          │
│            ▼                                                          │
│   4. For each user batch:                                            │
│      ┌─────────────────────────────────────────────────────────────┐ │
│      │  a. Load existing facts (for deduplication)                 │ │
│      │  b. Build extraction prompt                                 │ │
│      │  c. Call Claude Opus 4.5                                    │ │
│      │  d. Parse JSON response                                     │ │
│      │  e. Check for duplicates (case-insensitive)                 │ │
│      │  f. If duplicate: REINFORCE existing fact                   │ │
│      │     - Boost confidence by +0.1 (clamped)                    │ │
│      │     - Append new evidence                                   │ │
│      │     - Update lastReinforcedAt                               │ │
│      │  g. If new: Store fact                                      │ │
│      │  h. Mark messages as processed                              │ │
│      └─────────────────────────────────────────────────────────────┘ │
│            │                                                          │
│            ▼                                                          │
│   5. Log results (per-user metrics)                                  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Configuration:**

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `MEMORY_PROCESSOR_ENABLED` | `true` | Enable/disable processor |
| `MEMORY_PROCESSOR_INTERVAL_MS` | `300000` | Poll interval (5 min) |
| `MEMORY_PROCESSOR_BATCH_SIZE` | `100` | Max messages per run |
| `MEMORY_PROCESSOR_PER_USER_BATCH_SIZE` | `25` | Max per user per run |
| `MEMORY_MODEL_ID` | `claude-opus-4-5-20251101` | LLM for extraction |
| `MEMORY_LOG_VERBOSE` | `false` | Enable debug logging |

**Fact Reinforcement:**
When a duplicate fact is detected:
- Confidence boosted by +0.1 (clamped to 0.3-1.0)
- New evidence appended with timestamp
- `lastReinforcedAt` updated
- This strengthens frequently-mentioned facts over time

### Extraction Prompt

**Location:** [src/services/memory/prompts.ts](src/services/memory/prompts.ts)

The `buildExtractionPrompt` function creates a structured prompt for Claude.

**Extraction Criteria:**
- **Persistent** - Not temporary states
- **From user** - Not assistant responses (except tool summaries)
- **Not duplicate** - Even if worded differently
- **Atomic** - Single, self-contained piece
- **Third person** - Format: "Likes X" not "I like X"

**Output Format:**
```json
{
  "reasoning": "Brief explanation of analysis",
  "facts": [
    {
      "fact": "Likes black coffee",
      "category": "preferences",
      "confidence": 0.8,
      "source_type": "explicit",
      "evidence": "User said 'I prefer black coffee'"
    }
  ]
}
```

**Duplicate Detection Strategy:**
1. **Primary (LLM):** Claude sees existing facts in prompt
2. **Backup (Code):** Case-insensitive exact match
3. **Future (Phase 2):** Embedding-based semantic similarity

---

## Memory Agent

**Location:** [src/agents/memory/index.ts](src/agents/memory/index.ts)

Specialized agent for explicit memory management requests.

**Routing behavior (explicit path):**
- The classifier prompt instructs the LLM to treat memory-directed messages (remember/recall/forget/update, “what do you know about me”) as async work so the orchestrator runs tools.
- The planner prompt prefers `memory-agent` for store/recall/update/delete tasks; `general-agent` remains fallback.
- This ensures explicit memory edits happen immediately via tools (confidence=1.0) instead of waiting for the background processor.

**Tools Available:**

| Tool | Input | Description |
|------|-------|-------------|
| `extract_memory` | `{fact, category?}` | Store fact (confidence=1.0, sourceType='explicit') |
| `list_memories` | `{limit?}` | List user's facts (default 20, max 100) |
| `update_memory` | `{id, fact?, category?}` | Update existing fact |
| `remove_memory` | `{id}` | Delete a fact |

**Tool Implementations:** [src/tools/memory.ts](src/tools/memory.ts)

**Invocation:** Only when orchestrator detects explicit memory requests:
- "Remember that I like black coffee"
- "What do you know about me?"
- "Forget that I have a cat"
- "Update my preference to decaf"

---

## Context Injection

**Location:** [src/services/anthropic/prompts/context.ts](src/services/anthropic/prompts/context.ts)

Memory is injected into agent system prompts via XML format.

**Functions:**
- `buildMemoryXml(phoneNumber)` - Loads and formats facts from storage
- `buildUserMemoryXml(facts, options)` - Formats facts with char cap
- `buildFactsXml(facts, options)` - Renders facts as XML
- `buildUserContext(userConfig, memoryXml)` - Full user context block

**XML Format:**
```xml
<user_memory>
  <profile>
    <name>Alex</name>
    <timezone>America/Los_Angeles</timezone>
  </profile>
  <facts>
    Works as software engineer. Likes black coffee. Has a dog named Max.
  </facts>
</user_memory>
```

**Selection Options:**
- `maxFacts` - Limit number of facts
- `maxChars` - Character cap (uses ranking to select best facts)

---

## Response Composer Integration

**Location:** [src/orchestrator/response-composer.ts](src/orchestrator/response-composer.ts)

Memory facts are also injected into the response composition step.

**Integration:**
- Facts included in composition prompt (limited to 20 facts, 1500 chars)
- Helps LLM compose personalized responses
- Uses user's name naturally if available
- Maintains data fidelity for specific requests (numbers, amounts)

---

## Orchestrator Integration

### Handler Flow

**Location:** [src/orchestrator/handler.ts](src/orchestrator/handler.ts)

```
1. Receive user message
2. Load in parallel:
   - Conversation history
   - User facts via getMemoryStore().getFacts(phoneNumber)
3. Pass to orchestrator
4. Facts available via PlanContext
```

### Plan Context

**Location:** [src/orchestrator/orchestrate.ts](src/orchestrator/orchestrate.ts)

```typescript
interface PlanContext {
  userMessage: string;
  conversationHistory: ConversationMessage[];
  userFacts: UserFact[];        // Facts available here
  userConfig: UserConfig | null;
  phoneNumber: string;
  channel: 'sms' | 'whatsapp';
  stepResults: {};
  errors: [];
}
```

---

## Admin UI

**Location:** [src/admin/](src/admin/)

Web interface for viewing and managing stored memories.

**Routes:**
```
GET /admin/memory              # HTML interface
GET /admin/api/memories        # List all memories (JSON)
DELETE /admin/api/memories/:id # Delete specific memory
```

**Features:**
- View all memories grouped by phone number
- Display fact details: category, confidence, source type, timestamps, evidence
- Delete individual facts with confirmation
- Light/dark mode (system preference + toggle)
- Summary statistics (total facts, user count)
- Responsive design

---

## Conversation Store Integration

**Location:** [src/services/conversation/sqlite.ts](src/services/conversation/sqlite.ts)

Messages track memory processing status:

```typescript
{
  memoryProcessed: boolean;     // Whether processed for extraction
  memoryProcessedAt?: number;   // Timestamp of processing
}
```

**Query Methods:**
- `getUnprocessedMessages(options)` - Returns unprocessed messages (FIFO, per-user cap)
- `markAsProcessed(messageIds)` - Marks messages as processed

---

## File Reference

| File | Purpose |
|------|---------|
| [src/services/memory/types.ts](src/services/memory/types.ts) | Type definitions |
| [src/services/memory/sqlite.ts](src/services/memory/sqlite.ts) | SQLite implementation |
| [src/services/memory/index.ts](src/services/memory/index.ts) | Singleton factory |
| [src/services/memory/processor.ts](src/services/memory/processor.ts) | Background extraction |
| [src/services/memory/prompts.ts](src/services/memory/prompts.ts) | Extraction prompts |
| [src/services/memory/ranking.ts](src/services/memory/ranking.ts) | Fact ranking/selection |
| [src/agents/memory/index.ts](src/agents/memory/index.ts) | Memory agent |
| [src/tools/memory.ts](src/tools/memory.ts) | Tool implementations |
| [src/services/anthropic/prompts/context.ts](src/services/anthropic/prompts/context.ts) | Context injection |
| [src/orchestrator/handler.ts](src/orchestrator/handler.ts) | Handler integration |
| [src/orchestrator/orchestrate.ts](src/orchestrator/orchestrate.ts) | Orchestration |
| [src/orchestrator/response-composer.ts](src/orchestrator/response-composer.ts) | Response composition |
| [src/services/conversation/sqlite.ts](src/services/conversation/sqlite.ts) | Conversation tracking |
| [src/admin/memory.ts](src/admin/memory.ts) | Admin API handlers |
| [src/admin/views/memory.html](src/admin/views/memory.html) | Admin UI |
| [src/config.ts](src/config.ts) | Configuration |

---

## Lifecycle

### Startup

**Location:** [src/index.ts](src/index.ts)

```typescript
import { startMemoryProcessor } from './services/memory/processor';

// After server ready
startMemoryProcessor();
```

### Shutdown

```typescript
import { stopMemoryProcessor, closeMemoryStore } from './services/memory';

stopMemoryProcessor();
closeMemoryStore();
```

---

## Design Decisions

### 1. Dual Extraction Pathways
- **Background async** (primary) - Reduces conversation latency
- **Explicit requests** (secondary) - Immediate feedback when user asks

### 2. Confidence-Based Fact Management
- Higher confidence facts prioritized in context injection
- Low confidence observations auto-deleted after 180 days
- Reinforcement increases confidence when facts are mentioned again

### 3. Atomic Facts Philosophy
Each fact is a single, self-contained piece of information:
- Enables flexible querying and management
- Bad: "has a dog and likes coffee"
- Good: Two separate facts

### 4. Multi-User Isolation
- All facts scoped by `phoneNumber`
- No cross-user memory sharing
- Per-user batch limits in processor

### 5. Graceful Degradation
- Processor failures don't block conversations
- Individual user batch failures don't affect others
- Missing memory doesn't break the system

### 6. Evidence Tracking
- Supports fact provenance
- Helps with deduplication decisions
- Maintains audit trail of reinforcements
