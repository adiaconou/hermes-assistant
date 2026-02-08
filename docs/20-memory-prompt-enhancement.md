# Memory Processor Prompt Enhancement Plan

## Goal

Transform the memory processor from simple fact extraction to intelligent pattern recognition that learns about the user from all conversation data including agent tool interactions.

---

## Requirements Summary

Based on discussion:

| Requirement | Decision |
|-------------|----------|
| Pattern detection | Extract patterns from repeated observations, not just single facts |
| Confidence scores | LLM assigns 0.0-1.0 based on evidence strength guidelines; code boosts on reinforcement |
| Data sources | Analyze user messages **and assistant responses** (tool-summary style) |
| Assistant safety | Always filter assistant turns to tool summaries; skip acknowledgments/speculation to avoid self-reinforcement |
| Privacy | Strict exclusions for credentials, account numbers, SSNs, etc. |
| Fact changes | Store all facts with timestamps; consuming agent uses recency (supersession deferred to V2) |
| Output types | Unified "facts" array; observation vs pattern is conceptual guidance (confidence distinguishes) |
| Output format | Enhanced JSON with confidence, source_type, evidence fields |
| Extraction style | Balanced - reasonable inference, require some signal strength |
| Priority patterns | Relationships, Behavioral preferences, Recurring events |
| Token/char cap | Single shared char cap + simple ranking helper for prompt/injection |
| Observation decay | Auto-delete observations > 180 days with confidence < 0.6 |
| Robust parsing | Processor accepts both array and {facts: []}, validates fields, and does not mark messages processed on parse/LLM failure |
| Prompt metadata | Include role + timestamp per message and timestamps on existing facts so model can detect recency/patterns |
| Injection cap | Same shared ranking helper/char cap to prevent context bloat |
| Configurability | Model ID via config; single retry/backoff on LLM errors |
| Confidence clamping | Clamp confidence to 0.3–1.0 before storage/injection |
| Evidence hygiene | Truncate evidence (e.g., 120 chars); omit from injection |
| Basic metrics | Emit counters for success, parse_fail, llm_error, reinforced |
| Retry safety | Single retry with backoff; then poison metric, stop reprocessing |
| Logging scope | Full prompts/responses only in local/dev; never in prod |

---

## Key Changes

### Execution Notes (for fresh sessions)

- Defaults: char cap for prompt/injection = 4000 chars; evidence cap = 120 chars; confidence clamped to 0.3–1.0; single retry with 30s backoff; default model id = `claude-opus-4-5-20251101` (override via `MEMORY_MODEL_ID`).
- Assistant heuristic: include assistant turns only if they look like tool summaries (regex cue example: `/\\b(found|your (calendar|email)|i see|based on your (email|calendar)|according to)\\b/i`); skip all other assistant turns.
- Ranking helper: sort facts by confidence DESC, then lastReinforcedAt/extractedAt DESC; take established (>=0.6) first, then newest observations until char cap reached; same helper used for extraction prompt and injection.
- Logging: `MEMORY_LOG_VERBOSE=false` in prod; set true only in dev/local; never log full prompts/responses in prod.
- Migration: run the memory schema migration before deploying; back up `data/memory.db` first.
- Tests to run: `npm test` (focus on memory processor/sqlite suites); verify counters/metrics show no parse_fail or llm_error after sample run.
- Rollout order: migrate DB → deploy → run processor once in dev with verbose logging to inspect prompt/response → disable verbose → promote to prod.

### 1. Expanded Input Analysis

Analyze both user messages (`role: 'user'`) and assistant responses, with a safety heuristic to avoid self-reinforcement.

#### Why Assistant Responses?

Assistant responses contain summarized insights from tool interactions:
- "I found 3 emails from Chase about your credit card statement"
- "Your calendar shows weekly meetings with Sarah on Tuesdays"
- "Based on your emails, your flight is on March 5th"

This is more efficient than processing raw tool outputs because:
1. **Already summarized** - The agent already distilled key information
2. **Reasonable size** - Responses are typically a few hundred tokens, not thousands
3. **Contains the insights** - Important facts are surfaced, not buried in JSON

#### What This Enables

The processor can learn from:
- Email patterns (recurring bills, frequent contacts) via assistant summaries
- Calendar patterns (regular meetings, appointment types)
- Tool interaction patterns (what user asks for frequently)

#### Treatment of Message Types

Include assistant turns only when they appear to summarize tool outputs (e.g., contain cues like “Found”, “Your calendar shows”, “I see X emails”, “Based on your emails”). Skip acknowledgments, chit-chat, or speculation to avoid self-reinforcement.

#### Message Metadata for Pattern Detection

Provide the model with role labels and timestamps to help it reason about recency and repetition, e.g.:
```
[user | 2026-01-20T18:03Z]: I got a bill from Chase
[assistant | 2026-02-18T18:05Z]: Found 3 Chase statements (Jan 15, Feb 15, Mar 15)
```
Existing facts listed with “learned at” timestamps for the same purpose.

### 2. Observation vs Pattern (Conceptual Guidance)

The prompt guides the LLM to think about facts in two categories, but output is unified to a single array:

| Concept | Description | Confidence Range |
|---------|-------------|------------------|
| **Observations** | Single occurrences, first-time sightings | 0.3 - 0.5 |
| **Patterns** | Repeated occurrences or strong evidence | 0.6 - 1.0 |

The confidence score itself distinguishes observations from patterns - no need for separate output arrays.

#### Confidence Score Guidelines

Confidence represents "How certain are we this fact is true and will remain relevant?"

The LLM assigns confidence based on its judgment of evidence strength:

| Score | Meaning | Examples |
|-------|---------|----------|
| **0.3** | Weak signal, single inferred observation | Saw one email from a company |
| **0.4** | Single observation with some context | Mentioned a preference in passing |
| **0.5** | Clear single statement or 2 weak observations | User explicitly stated something once |
| **0.6** | Pattern emerging, 2-3 clear data points | Two meetings with same person |
| **0.7** | Solid pattern, multiple confirmations | Monthly bill seen 3+ times |
| **0.8** | Strong pattern, consistent over time | Weekly recurring event |
| **0.9** | Very confident, repeatedly confirmed | Core preference mentioned many times |
| **1.0** | Absolute certainty | User explicitly asked to remember this |

**Guidance for the LLM:**
- Use your judgment - these are guidelines, not rigid rules
- Consider: How explicit was the statement? How many data points? How consistent?
- Explicit user statements deserve higher confidence than inferences
- Patterns synthesized from multiple observations should be 0.6+
- When uncertain, lean toward lower confidence (can be boosted later via reinforcement)

### 3. Unified JSON Output Format

```json
{
  "facts": [
    {
      "fact": "Received a credit card bill from Chase",
      "category": "recurring",
      "confidence": 0.3,
      "source_type": "inferred",
      "evidence": "Email from Chase dated 2024-01-15"
    },
    {
      "fact": "Receives Chase credit card bill monthly around the 15th",
      "category": "recurring",
      "confidence": 0.8,
      "source_type": "inferred",
      "evidence": "Bills observed on 2024-01-15, 2023-12-15, 2023-11-14"
    }
  ]
}
```

**Why unified?**
- Confidence score already distinguishes observations (<0.6) from patterns (>=0.6)
- Simpler parsing in code - one array instead of two
- Prompt still teaches the LLM about observation vs pattern thinking for better calibration

**Notes**:
- Reinforcement is handled in code, not by the LLM. When the LLM extracts a fact that matches an existing one, the processor boosts the existing fact's confidence instead of creating a duplicate.
- Supersession (detecting contradictions) is deferred to a future version. For V1, all facts are stored with timestamps. The consuming agent uses recency to determine which is current.
- Parser accepts both the legacy array format and the new `{ "facts": [] }` object. If parsing fails or the LLM call errors, the batch is not marked processed so it can be retried.
- Confidence values are clamped to 0.3–1.0 before storage/injection.
- Evidence should be concise, non-sensitive, and length-capped; omit raw PII/tool payloads.

### 4. Expanded Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `preferences` | Food, drinks, communication style | Prefers morning meetings, likes black coffee |
| `health` | Allergies, conditions, medications | Allergic to peanuts, takes blood pressure medication |
| `relationships` | Family, pets, friends, colleagues | Has daughter named Emma, works with Sarah frequently |
| `work` | Job, company, role, schedule | Product manager at Google, works 9-5 PST |
| `interests` | Hobbies, activities, topics | Enjoys hiking, interested in AI |
| `personal` | Location, birthday, general info | Lives in San Francisco, birthday in March |
| `recurring` | **NEW** Bills, subscriptions, appointments | Chase bill on 15th, Netflix subscription, weekly therapy |
| `behavioral` | **NEW** Activity patterns, habits | Most active in mornings, prefers SMS over email |
| `context` | **NEW** Current projects, situations | Working on Q4 launch, planning vacation |
| `other` | Anything that doesn't fit above | |

### 5. Strict Privacy Exclusions

**Never extract** (even if mentioned repeatedly):

- Passwords, PINs, security codes
- Full credit card numbers, bank account numbers
- Social Security Numbers, government IDs
- API keys, tokens, authentication credentials
- Specific medical test results or diagnoses (general conditions OK)
- Full addresses with unit numbers (city/neighborhood OK)

### 6. Pattern Detection Across Batches

**Problem**: The processor runs on individual batches - the LLM has no memory between runs. To detect patterns like "Chase bill arrives monthly", it needs to see multiple occurrences across time.

**Solution**: Include recent observations in the prompt so the LLM can synthesize patterns.

#### How It Works

| Run | LLM Sees | LLM Outputs | Code Does |
|-----|----------|-------------|-----------|
| Jan | Chase bill in conversation | Fact: "Received Chase bill" (0.3) | Stores new fact |
| Feb | Jan fact + new Chase bill | Fact: "Receives Chase bill monthly" (0.6) | Stores new fact |
| Mar | Existing facts + new Chase bill | Fact: "Receives Chase bill monthly" (0.6) | Detects duplicate, boosts existing to 0.7 |

#### Prompt Structure

```
<established_facts>
[Confidence >= 0.6 - confirmed patterns and facts]
- Likes black coffee (0.9, learned 2025-12-10)
- Receives Chase bill monthly around mid-month (0.7, learned 2026-02-15)
</established_facts>

<recent_observations>
[Confidence < 0.6, from last 180 days - may form patterns]
- Had meeting with Sarah on Jan 10 (0.3, learned 2026-01-10)
- Had meeting with Sarah on Jan 17 (0.3, learned 2026-01-17)
- Ordered from DoorDash on Jan 12 (0.3, learned 2026-01-12)
</recent_observations>
```

#### Observation Retention: 180 Days

- Observations older than 180 days are excluded from the prompt
- This window catches: monthly (6x), quarterly (2x), and some seasonal patterns
- Annual patterns require the first occurrence to promote to a fact within 180 days (may need future refinement)
- Observations older than 180 days with confidence < 0.6 are auto-deleted from storage

#### Simple Ranking & Cap (shared by prompt and injection)

- Sort facts by confidence DESC, then by recency (lastReinforcedAt/extractedAt).
- Walk the list and stop when a shared char cap is reached (char-based budget instead of token estimate).
- Prefer established (>=0.6); if space remains, add newest observations.
- Use the same helper for building extraction prompt sections and for downstream injection to keep behavior consistent.

#### Pattern Synthesis Instructions

The prompt instructs the LLM to:

1. **Recurring patterns**: Look for repeated observations - synthesize into higher-confidence patterns
2. **Relationship dynamics**: Infer relationships from communication frequency and context
3. **Behavioral patterns**: Notice when user is active, how they prefer to communicate
4. **Temporal patterns**: Weekly routines, seasonal activities, time-of-day preferences

Note: Reinforcement (boosting confidence for repeated observations) is handled in code, not by the LLM.

### 7. Fact Evolution Handling (V1: Timestamp-Based)

For V1, contradicting facts are handled by storing all facts with timestamps. The consuming agent determines relevance based on recency.

**Example**: User moves from SF to Seattle
```
Stored facts (both kept):
- "Lives in San Francisco" (confidence: 0.9, extracted: Jan 2024)
- "Lives in Seattle" (confidence: 0.7, extracted: Mar 2024)
```

When injected into agent prompts, facts include timestamps so the agent can reason about recency:
```
- Lives in San Francisco (learned Jan 2024)
- Lives in Seattle (learned Mar 2024)  ← agent infers this is current
```

Automatic supersession detection is deferred to a future version when semantic matching is available.

---

## Files to Modify

### Primary: `src/services/memory/prompts.ts`

Complete rewrite of `buildExtractionPrompt()`:

```typescript
export function buildExtractionPrompt(
  existingFacts: UserFact[],
  messages: ConversationMessage[]
): string {
  // New comprehensive prompt with:
  // - Pattern recognition focus
  // - Enhanced examples for all categories
  // - Observations vs patterns guidance
  // - Privacy exclusions
  // - Instructions for agent tool output analysis
  // - Role + timestamp annotations on messages
  // - Existing facts rendered with learned timestamps
  // - Shared ranking helper (confidence, then recency, char cap)
}
```

### Secondary: `src/services/memory/types.ts`

Update `UserFact` interface:

```typescript
export interface UserFact {
  id: string;
  phoneNumber: string;
  fact: string;
  category: string;

  // NEW fields
  confidence: number;                    // 0.0-1.0
  sourceType: 'explicit' | 'inferred';   // How was this derived?
  evidence?: string;                     // What led to this fact?
  lastReinforcedAt?: number;             // When was this fact last confirmed? (for prioritization)

  extractedAt: number;
}
```

### Secondary: `src/services/memory/processor.ts`

Updates needed:

1. **Assistant messages**: Process assistant turns that match the summary heuristic (tool-style cues); continue to process user turns as before.
2. **Robust parsing**: Accept both `[ ... ]` and `{ facts: [...] }`; validate required fields; on parse/LLM error do **not** mark messages processed so they retry. Add a single retry with fixed backoff; after that emit a poison metric and stop retrying that batch.
3. **Code-based reinforcement**: When LLM extracts a fact similar to an existing one:
   - Detect the match using `findSimilarFact()` (case-insensitive for now, semantic later)
   - Boost existing fact's confidence by 0.1 (capped at 1.0)
   - Update `lastReinforcedAt` timestamp
   - Append to evidence field with timestamp
   - Skip creating duplicate
4. **Ranking + cap**: Use shared helper (confidence desc, then recency) with char cap for both prompt sections and injection. Prefer established (>=0.6), then newest observations.
5. **Observation cleanup**: Delete observations older than 180 days with confidence < 0.6
   - Run as part of each processor cycle
   - Log deletions for debugging
6. **Model configurability**: Read model ID from config/env instead of hardcoding.
7. **Prompt metadata**: Include role and ISO timestamp per message; include learned timestamp in fact listings.
8. **Retry safety**: Single retry with fixed backoff; surface poison metric after second failure.
9. **Metrics**: Emit minimal counters: success, parse_fail, llm_error, reinforced. (Optional: assistant_included, stale_deleted.)

### Secondary: `src/services/memory/sqlite.ts`

Schema migration:

```sql
ALTER TABLE user_facts ADD COLUMN confidence REAL DEFAULT 0.5;
ALTER TABLE user_facts ADD COLUMN source_type TEXT DEFAULT 'explicit';
ALTER TABLE user_facts ADD COLUMN evidence TEXT;
ALTER TABLE user_facts ADD COLUMN last_reinforced_at INTEGER;
```

Backfill existing rows: set `source_type='explicit'`, `confidence=0.5` (or 0.6 if previously reinforced), and `last_reinforced_at = extracted_at` to keep recency ordering sane. Provide a one-time migration script before processor changes roll out.

New method needed:

```typescript
// Delete stale observations (confidence < 0.6, older than 180 days)
deleteStaleObservations(): Promise<number>
```

### Secondary: `src/services/anthropic/prompts/context.ts`

- Add capped injection using the shared ranking helper (confidence desc, then recency) with char cap.
- Prefer established facts; then newest observations if space remains.
- Drop evidence from injected context to save tokens (keep it stored for diagnostics).

### Secondary: `src/config.ts`

- Add `MEMORY_MODEL_ID` (default current Claude model).
- Add `MEMORY_LOG_VERBOSE` (default: false) and gate full prompt/response logging to dev/local only (never in prod).
- Char cap can remain a code constant for now; expose later if needed.

---

## New Prompt Structure

```markdown
## Role

You are a personal memory system that builds comprehensive understanding of a user
from their conversations. Your goal is to identify meaningful patterns and facts
that help personalize future interactions.

## What You're Analyzing

You receive full conversation transcripts including:
- **User messages**: What the user says directly
- **Assistant responses**: Summaries of tool results (email searches, calendar queries, etc.)

Assistant responses are included only when `MEMORY_INCLUDE_ASSISTANT` is enabled and the turn looks like a tool summary (see filters above).

Both message types are valuable:
- User messages contain explicit statements and requests
- Assistant responses contain summarized insights from tools (e.g., "Found 3 emails from Chase about your statement")

Extract facts from both, using your judgment on source_type:
- User explicitly states something → `explicit`
- Information from assistant's tool summaries → `inferred`

## Types of Insights to Extract

### 1. Observations (Single Occurrence)
First-time observations that may become patterns with more evidence.
- Assign confidence 0.3-0.5
- Mark source_type as 'inferred' unless explicitly stated

### 2. Patterns (Confirmed)
Observations backed by multiple data points or strong evidence.
- Assign confidence 0.6-1.0
- Include evidence field with specific examples
- If you see observations in recent_observations that form a pattern, synthesize them

## Confidence Scoring

Confidence = "How certain are we this fact is true and will remain relevant?"

Use your judgment based on evidence strength:

| Score | When to Use |
|-------|-------------|
| 0.3 | Weak signal, single inferred observation |
| 0.4 | Single observation with some context |
| 0.5 | Clear single explicit statement |
| 0.6 | Pattern emerging (2-3 data points) |
| 0.7 | Solid pattern, multiple confirmations |
| 0.8 | Strong pattern, consistent over time |
| 0.9 | Very confident, repeatedly confirmed |
| 1.0 | User explicitly asked to remember this |

Guidelines:
- Explicit statements deserve higher confidence than inferences
- When uncertain, lean lower (system can boost via reinforcement later)
- Patterns synthesized from observations should be 0.6+

Note: Reinforcement (when new data supports existing facts) is handled automatically.
Just extract what you observe - the system will detect matches and boost confidence.

## Categories

[Expanded list with detailed examples for each]

## Privacy Exclusions

NEVER extract these, even if mentioned multiple times:
- Passwords, PINs, security codes
- Full credit card/bank account numbers
- SSNs, government IDs
- API keys, tokens, credentials
- Specific medical diagnoses

## Existing Knowledge

<existing_facts>
{existingFactsList with learned timestamps}
</existing_facts>

## Conversation to Analyze

<conversation>
{messagesList with role + ISO timestamp}
</conversation>

## Output Format

Return ONLY valid JSON in this exact structure:
{
  "facts": [...]
}

Each fact should have: fact, category, confidence, source_type, evidence (optional)

## Examples

[Comprehensive examples covering all categories and edge cases]
```

---

## Verification Plan

### Unit Tests (`tests/unit/memory-processor.test.ts`)

Add tests for:

1. **New JSON parsing**: Handle unified `facts` array
2. **Confidence handling**: Verify scores are in valid range (0.3-1.0)
3. **Privacy exclusions**: Verify sensitive data not extracted
4. **Code-based reinforcement**: When LLM extracts duplicate fact, existing fact's confidence is boosted (not duplicated), and `lastReinforcedAt` is updated
5. **180-day observation window**: Old low-confidence facts excluded from prompt
6. **Token budget - established facts**: When over ~2000 tokens, lower-priority facts are excluded from prompt
7. **Stale observation cleanup**: Observations > 180 days with confidence < 0.6 are deleted from storage
8. **Assistant ingestion**: Assistant messages that match the summary heuristic are processed; others are ignored.
9. **Parse/LLM failure path**: On malformed LLM response or thrown error, messages remain unprocessed and are retried once.
10. **Injection capping**: Facts injected are capped and ordered by shared ranking helper.
11. **Retry safety**: After single retry failure, poison metric emitted and batch stops reprocessing.
12. **Evidence hygiene**: Evidence is trimmed/capped (e.g., 120 chars); no evidence in injections.

### Manual Testing

1. Run processor on sample conversations with agent tool outputs
2. Verify patterns correctly identified from email/calendar data
3. Verify privacy exclusions working
4. Check confidence scores are reasonable
5. Verify duplicate facts boost confidence (reinforcement)
6. Verify assistant summaries are ingested only when flag enabled and resemble tool outputs
7. Validate injections stay under target token/char limits
8. Confirm verbose logging only appears in dev/local when `MEMORY_LOG_VERBOSE` is enabled; no prompts/responses in prod logs.

### Debug Log Review

Check `memory-processor.log` for:
- Prompt being sent
- LLM response parsing
- Confidence score distribution
- Categories being used
- Ensure logs avoid sensitive content; consider truncating message bodies.

---

## Implementation Order

0. **Migration** - Add/backfill new columns with defaults
1. **types.ts** - Add new interface fields (confidence, sourceType, evidence)
2. **sqlite.ts** - Add schema migration + stale deletion helper
3. **config** - Make model ID and verbose logging toggle configurable
4. **prompts.ts** - Rewrite prompt with pattern recognition, timestamps, role labels
5. **processor.ts** - Update parsing, reinforcement, shared ranking/char cap, retry/no-mark-on-first-failure, assistant filter
6. **context.ts** - Add ranked, capped injection (shared helper)
7. **tests** - Update unit tests for new behavior and failure paths
8. **verification** - Manual testing and log review

---

## Detailed Implementation Plan (execution scratchpad)

### 0) Migrations
- Add SQL migration (versioned script) to add columns: confidence REAL DEFAULT 0.5, source_type TEXT DEFAULT 'explicit', evidence TEXT, last_reinforced_at INTEGER.
- Backfill existing rows: set source_type='explicit', confidence=0.5, last_reinforced_at=extracted_at; run inside a transaction.
- Add CLI/script entry to run migrations before enabling new processor.

### 1) Types (`src/services/memory/types.ts`)
- Expand `UserFact` with `confidence`, `sourceType`, `evidence?`, `lastReinforcedAt?`.
- Update `MemoryStore.updateFact` typing to allow new fields (except id/phoneNumber).

### 2) SQLite store (`src/services/memory/sqlite.ts`)
- Initialize new columns in schema if creating fresh DB.
- Implement `deleteStaleObservations()` (confidence < 0.6 AND extracted_at older than 180 days).
- Update CRUD to read/write new fields; set defaults on insert when absent.
- Ensure getters map `source_type`, `confidence`, `evidence`, `last_reinforced_at`.

### 3) Config (`src/config.ts`)
- Add env keys: `MEMORY_MODEL_ID`, `MEMORY_INCLUDE_ASSISTANT` (default false), `MEMORY_LOG_VERBOSE` (default false).
- Char cap stays a code constant for now; expose later if needed.
- Wire defaults; export in config.memoryProcessor or memory section.

### 4) Prompt builder (`src/services/memory/prompts.ts`)
- Rewrite `buildExtractionPrompt` to include:
  - Role + ISO timestamp per message; assistant messages only when flag on and pass summary heuristic.
  - Existing facts section with confidence + learned timestamp, separated into established (>=0.6) and observations (<0.6) using shared ranking helper + char cap.
  - Privacy exclusions, categories, observation vs pattern guidance, unified JSON output spec.
  - Example block updated to new fields.
  - Add shared ranking helper (confidence desc, then recency) + char cap (no token estimator).

### 5) Processor (`src/services/memory/processor.ts`)
- Accept both `[ ... ]` and `{ facts: [...] }` with schema validation; clamp confidence 0.3–1.0; trim/cap evidence; drop empty facts.
- Add assistant-ingest gate + summary heuristic; keep role filter otherwise.
- Implement reinforcement: findSimilar (case-insensitive for now), boost +0.1 capped at 1.0, set lastReinforcedAt=now, append evidence with timestamp.
- Add retry/backoff: single retry with fixed delay; skip marking processed on first failure; emit poison metric and stop after second failure.
- Add minimal metrics counters: success, parse_fail, llm_error, reinforced (optional: assistant_included, stale_deleted).
- Respect `MEMORY_MODEL_ID`; default to current Claude model.
- Invoke `deleteStaleObservations()` each cycle.
- Logging: full prompt/response only when `MEMORY_LOG_VERBOSE` true AND env is dev/local; otherwise log summary only.

### 6) Context injection (`src/services/anthropic/prompts/context.ts`)
- Add ranked, capped selection using shared scoring helper; prefer established facts; fallback to newest observations; enforce shared char cap.
- Exclude evidence from injected facts to save tokens.

### 7) Tests
- Update unit tests for new fields and parsing shape.
- Add coverage for: assistant flag on/off; parse failures retain messages; confidence clamp; evidence cap; reinforcement boost; stale deletion; retry cap; injection capping; metrics hooks (can assert logger/mocks).
- Extend sqlite tests for new columns and deleteStaleObservations.

### 8) Manual verification
- Run migration on dev DB; inspect schema.
- Run processor with sample conversations including assistant summaries; confirm stored facts, confidence, lastReinforcedAt, evidence capped.
- Toggle verbose logging to confirm dev-only behavior.
- Validate injection output respects caps and omits evidence.

### Rollout checklist
- Apply migration.
- Deploy with `MEMORY_INCLUDE_ASSISTANT=false`, `MEMORY_LOG_VERBOSE=false` in prod.
- Enable assistant ingest gradually per-tenant; monitor metrics (parse_fail, llm_error, reinforced, stale_deleted, assistant_included).
- After stable, consider increasing token budgets or enabling assistant ingest globally.

---

## Future Considerations

- **Semantic similarity**: Use embeddings to detect near-duplicate facts (Phase 2 in types.ts)
- **Supersession detection**: Automatically detect and mark contradicting facts (requires semantic matching)
- **User feedback**: Allow user to correct/reject extracted facts
- **Export**: Let user see what the system knows about them
- **Tunable budgets**: Allow per-user or global adjustment of token budgets
