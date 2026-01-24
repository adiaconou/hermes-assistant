# Memory System PRD

**Version**: 1.0
**Last Updated**: 2026-01-23
**Status**: Draft
**Owner**: TBD

---

## Executive Summary

This PRD defines a multi-layered memory system for the personal assistant that enables it to remember and utilize information about the user across conversations. The system will support three types of memory inspired by cognitive science: semantic (facts), episodic (experiences), and procedural (learned behaviors). The initial phase focuses on semantic memory with a clear path to extend to other memory types.

---

## Problem Statement

Currently, the assistant:
- Has limited context about the user (only name and timezone via `user_config`)
- Cannot remember facts learned in previous conversations beyond 50-message window
- Requires users to repeat information frequently
- Cannot personalize responses based on learned preferences
- Has no persistent understanding of user's life context

This creates friction and reduces the assistant's utility as a truly personal assistant.

---

## Goals

1. **Remember core user information** automatically across sessions (name, timezone, preferences)
2. **Extract and store facts** from conversations without explicit user commands
3. **Inject relevant context** into every conversation to enable personalization
4. **Scale gracefully** as memory grows (start with load-all, migrate to semantic search)
5. **Build extensible foundation** for episodic and procedural memory in future phases

---

## Non-Goals

1. **Not building** a full knowledge graph with explicit relationship modeling (use implicit relationships via LLM)
2. **Not implementing** vector search in Phase 1 (load all memory into context initially)
3. **Not supporting** memory sharing across users or multi-user contexts
4. **Not providing** user-facing memory management UI initially (future enhancement)
5. **Not storing** conversation transcripts as episodic memory in Phase 1

---

## User Needs

### As a user, I want to:
- Have the assistant remember my name, timezone, and basic preferences
- Not repeat information I've already shared
- Have the assistant understand context from previous conversations
- Trust that the assistant "knows me" and can personalize responses
- (Future) Have the assistant recall specific past events when relevant
- (Future) Have the assistant learn my interaction preferences over time

---

## Memory Types

### 1. Semantic Memory (Phase 1 - MVP)

**Definition**: Timeless facts and general knowledge about the user.

**Examples**:
- Profile: "Name is Alex", "Lives in San Francisco", "Works as software engineer"
- Preferences: "Likes black coffee", "Prefers brief responses", "Uses he/him pronouns"
- Relationships: "Has a dog named Max", "Sister named Sarah lives in LA"
- Constraints: "Allergic to peanuts", "Vegetarian", "Quiet hours: 10pm-7am"

**Characteristics**:
- Atomic facts (one fact per memory unit)
- No temporal context (when it was learned matters less than the fact itself)
- High confidence, relatively stable over time
- Automatically extracted from conversations
- Injected into system prompt at start of every session

**Requirements**:
- [ ] System automatically extracts facts from user messages as simple atomic sentences
- [ ] Facts are stored with metadata: category (optional), timestamps
- [ ] Extraction keeps facts simple (e.g., "Likes black coffee" not "User mentioned they like black coffee")
- [ ] Duplicate/conflicting facts are handled (update vs. new entry)
- [ ] Extracted facts are immediately visible in the same conversation (memory reloaded after extraction)
- [ ] All semantic memory loaded into context at session start (Phase 1)
- [ ] Facts are joined into plain text for prompt injection (token-efficient)
- [ ] Agent can update existing facts when user provides corrections
- [ ] Agent can remove facts when user asks to forget something
- [ ] User can see what the assistant has remembered (list_memories tool)
- [ ] User can correct or delete incorrect facts (via update_memory/remove_memory tools)

**Extraction Guidelines**:
- Extract facts as atomic, self-contained sentences
- Keep facts concise and in third person or first person context
- Examples: "Likes black coffee", "Works as software engineer", "Has a dog named Max"
- Avoid: "User said they like coffee", "I learned that the user works as an engineer"
- LLM should extract facts and optionally suggest categories during extraction (stored in DB, not shown in prompt)

**Memory Management Tools**:

The assistant has three core tools for managing semantic memory:

1. **extract_memory** - Extract new facts from conversation
   - Used when user shares new information about themselves
   - Supports batch extraction (multiple facts at once)
   - Returns `memory_updated: true` to signal memory reload needed
   - System validates and checks for duplicates before storing

2. **update_memory** - Update existing facts
   - Used when user corrects or clarifies previous information
   - Requires fact ID (from list_memories)
   - Allows updating fact text or category
   - Example: "Actually, I prefer tea" → updates the coffee preference fact

3. **remove_memory** - Remove specific facts
   - Used when user asks to forget something
   - Requires fact IDs (from list_memories)
   - Permanently deletes facts from database
   - Example: "Forget about my dog" → removes dog-related facts

4. **list_memories** - View all stored facts
   - Shows user what the assistant has remembered
   - Returns facts with IDs, categories, and timestamps
   - Used for transparency and debugging

**Duplicate Detection**:
- LLM sees all existing facts in `<user_memory>` section before extraction
- Tool instructions tell LLM: "Don't extract facts already in memory"
- LLM naturally detects semantic duplicates ("Likes coffee" = "Prefers coffee")
- Backup: Simple case-insensitive exact match in code (catches formatting variations)
- Phase 2: Add embedding-based similarity for more robust detection

**Injection Method**:
- Add to system prompt using XML tags (Claude is optimized for XML-structured prompts)
- Always present in every conversation
- Individual facts stored in database with metadata (category, timestamps)
- At runtime, facts are queried and joined into plain text for prompt injection
- Format (what Claude sees):
```xml
<user_memory>
  <profile>
    <name>Alex</name>
    <timezone>America/Los_Angeles</timezone>
  </profile>

  <facts>
    Likes black coffee. Allergic to peanuts. Has a dog named Max. Works as software engineer.
  </facts>
</user_memory>

Your task is to assist the user via SMS. Use information from <user_memory> to personalize your responses...
```

**Architecture:**
- **Database layer**: Facts stored as individual rows with metadata (id, fact text, category, timestamp)
- **Prompt generation**: Facts joined into plain sentences for token efficiency
- **Design rationale**: Database has structure for querying/filtering; prompt has simplicity for Claude's consumption
- **Token efficiency**: No XML tags per fact saves ~10 tokens per fact
- **Inspired by**: Letta (formerly MemGPT) memory block architecture
- **See**: Implementation doc for detailed schema and code

---

### 2. Episodic Memory (Phase 2)

**Definition**: Specific events and experiences with temporal/contextual details.

**Examples**:
- "On Jan 22, Alex mentioned feeling stressed about project deadline"
- "User and Sarah had dinner at Flour+Water on Jan 20"
- "Started new jogging routine Jan 15 - 3 miles every morning at 6:30am"
- "Complained about noisy neighbors last Tuesday evening"

**Characteristics**:
- Narrative format with time/place context
- Rich detail preserved (not reduced to atomic facts)
- Can spawn semantic facts (e.g., episode about coffee → "likes black coffee" fact)
- Retrieved via semantic search when contextually relevant
- Not loaded by default (only when relevant to current conversation)

**Requirements**:
- [ ] System creates episode entries for significant conversations
- [ ] Episodes have summary (brief) and narrative (detailed) fields
- [ ] Episodes link to related semantic facts extracted from them
- [ ] Semantic search retrieves top-K relevant episodes
- [ ] Episodes have decay/importance scoring
- [ ] User can trigger episode recall ("What did I say about my sister?")

**Injection Method**:
- Not in system prompt (too large)
- Retrieved via semantic search and added to user message context using XML tags
- Format:
```xml
<relevant_episodes>
  <episode id="ep1" timestamp="2026-01-22 09:30">
    <summary>Morning stress about project deadline</summary>
    <narrative>
      Alex mentioned feeling overwhelmed with the project deadline next week.
      His manager added three new requirements yesterday and he's worried about
      making the Friday deadline. He seemed particularly frustrated.
    </narrative>
  </episode>

  <episode id="ep2" timestamp="2026-01-20 19:00">
    <summary>Dinner plans with sister Sarah</summary>
    <narrative>
      Alex asked to be reminded about dinner with his sister Sarah on Saturday
      at 7pm at Flour+Water restaurant in Mission. Sarah is visiting from LA
      and they haven't seen each other in 3 months.
    </narrative>
  </episode>
</relevant_episodes>

[User's current message...]
```
- Episodes are semantically searched and only top-K most relevant are injected
- System prompt instructs model to use `<relevant_episodes>` for context

---

### 3. Procedural Memory (Phase 3)

**Definition**: Learned behaviors, routines, and interaction preferences.

**Examples**:
- Communication: "When user says 'quick update', provide bullet points only"
- Scheduling: "Always check calendar conflicts before suggesting times"
- Routines: "Send weather + calendar summary every morning at 7am"
- Preferences: "When suggesting restaurants, filter out places with peanuts"
- Patterns: "User typically asks for meeting prep the night before"

**Characteristics**:
- Action-oriented (trigger → procedure)
- Can be explicit rules or learned patterns
- Improves interaction efficiency over time
- May overlap with automation rules system

**Key Capabilities** (details TBD in Phase 3 planning):
- Learn interaction patterns from repeated behaviors
- Support explicit user-defined procedures
- Integrate with existing automation rules
- Influence system behavior, not just context

**Implementation Approach**:
- Could be system prompt modification (XML tags for learned behaviors)
- Could be automation rules/hooks that fire pre/post LLM call
- Could be hybrid approach combining both
- Design will be determined based on Phase 1/2 learnings and specific use cases

---

## Phased Rollout

### Phase 1: Semantic Memory MVP (Weeks 1-2)

**Scope**:
- Migrate existing `user_config` (name, timezone) into new memory system
- Add semantic facts storage (profile, preferences, relationships)
- Automatic fact extraction from conversations
- Load all memory into system prompt at session start

**Success Criteria**:
- Assistant remembers basic facts across sessions
- No need for user to repeat information
- Facts are automatically extracted with >80% accuracy
- Memory injection adds <500 tokens to system prompt

**Out of Scope**:
- Semantic search (load all facts into context)
- Episodic memory
- User memory management UI

---

### Phase 2: Semantic Search + Episodic Memory (Weeks 3-4)

**Scope**:
- Add vector embeddings to facts table
- Implement semantic search (retrieve top-K facts when memory > threshold)
- Add episodic memory storage
- Create episode entries from significant conversations
- Retrieve relevant episodes via semantic search

**Success Criteria**:
- System scales to 100+ facts per user
- Context window usage optimized (only relevant memories loaded)
- Episodes provide richer context when needed
- Episode recall works via semantic similarity

---

### Phase 3: Procedural Memory + Learning (Future)

**Scope**:
- Detect interaction patterns and suggest procedures
- Allow explicit procedure definition
- Integrate with automation rules
- Learn communication preferences over time

**Success Criteria**:
- Assistant adapts to user's interaction style
- Common tasks become more efficient via learned procedures
- User can define custom behaviors

---

## Open Questions

1. **Conflict Resolution**: When new information conflicts with existing facts (e.g., "I moved to Seattle" vs. existing "Lives in San Francisco"), how do we handle it?
   - Automatically replace with newer fact?
   - Ask user to confirm?
   - Store both with timestamps and let LLM decide?

2. **Memory Decay**: Should old, unmentioned facts decay in importance? Or remain forever?

3. **Privacy/Deletion**: How does user delete specific memories? Via SMS commands? Web UI?

4. **Multi-Turn Extraction**: If a fact spans multiple messages, how do we collect and combine them?

5. **Fact Granularity**: Where's the line between "Likes coffee" (semantic) vs. "Discussed coffee preferences on Tuesday" (episodic)?

6. **Category Taxonomy**: Should we predefine categories (profile, preferences, health, work) or let them emerge organically?

7. **Token Budget**: At what point does memory become too large for system prompt? What's the threshold to switch to semantic search?

8. **Fact Lifecycle**: When do facts get updated vs. new versions created? Track history or just latest?

9. **User Transparency**: Should every extracted fact be confirmed with the user? Or trust the LLM extraction?

---

## Success Metrics

### Phase 1 Metrics:
- **Fact Extraction Accuracy**: % of true facts correctly extracted (manual eval on sample)
- **Fact Completeness**: % of user-shared facts that are captured
- **False Positives**: % of stored facts that are incorrect
- **User Satisfaction**: Qualitative feedback on memory quality
- **Context Token Usage**: Average tokens added to system prompt per session

### Phase 2 Metrics:
- **Retrieval Relevance**: % of retrieved episodes/facts that are contextually relevant
- **Recall Coverage**: % of relevant memories successfully retrieved
- **Response Quality**: Improvement in response personalization (qualitative)

### Phase 3 Metrics:
- **Procedure Adoption**: % of suggested procedures user accepts
- **Efficiency Gains**: Reduction in back-and-forth for common tasks
- **Pattern Detection Accuracy**: % of learned patterns that match user behavior

---

## Dependencies

- LLM API (Anthropic Claude) for fact extraction
- SQLite storage for persistence
- (Phase 2) Vector embedding generation (Anthropic embeddings API or local model)
- (Phase 2) Vector similarity search (SQLite extension or external service)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| LLM extracts incorrect facts | High - Wrong information persists | Allow user corrections, manual review, human eval |
| Memory grows unbounded | Medium - Context/storage bloat | Implement decay, archive old memories, cap per user |
| Privacy concerns | High - Sensitive data stored | Encrypt at rest, clear deletion path, be transparent |
| Token budget exceeded | Medium - Can't load all context | Switch to semantic search when threshold hit |
| Fact conflicts not resolved | Low - Contradictory information | Timestamp-based recency, ask user to clarify |

---

## Future Enhancements

- Web UI for memory management (view, edit, delete)
- Memory sharing across devices/platforms
- Import/export memory dumps
- Memory analytics (what assistant knows, gaps in knowledge)
- Cross-user memory (team/family shared context)
- Memory-based insights ("I notice you always ask about X before Y")

---

## Appendix: Example Memory Formats

These examples show how memory is injected into the system prompt. Facts are stored as individual database rows but joined into plain text for Claude.

### Phase 1: New User (No Facts)
```xml
<user_memory>
  <profile>
    <timezone>America/Los_Angeles</timezone>
  </profile>
  <facts></facts>
</user_memory>
```

### Phase 1: Active User (5 Facts)
```xml
<user_memory>
  <profile>
    <name>Alex</name>
    <timezone>America/Los_Angeles</timezone>
  </profile>
  <facts>
    Works as software engineer. Likes black coffee. Has a dog named Max. Allergic to peanuts. Prefers brief, direct responses.
  </facts>
</user_memory>
```

### Phase 2: With Episodic Memory (Semantic Search)
```xml
<user_memory>
  <profile>
    <name>Alex</name>
    <timezone>America/Los_Angeles</timezone>
  </profile>
  <facts>
    Works as software engineer at tech startup. Likes black coffee, no sugar. Has a dog named Max, walks him at 7am daily. Allergic to peanuts. Sister Sarah lives in LA. Prefers brief responses. Vegetarian. Uses he/him pronouns.
  </facts>
</user_memory>

<relevant_episodes>
  <episode timestamp="2026-01-22 09:30">
    <summary>Morning stress about project deadline</summary>
    <narrative>Alex mentioned feeling overwhelmed with the project deadline next week. His manager added three new requirements yesterday and he's worried about making the Friday deadline.</narrative>
  </episode>
</relevant_episodes>
```

**Note**: Phase 2 uses semantic search to retrieve most relevant facts/episodes when memory grows large (20+ facts).

---

## References

- [MemGPT Paper](https://arxiv.org/abs/2310.08560) - Hierarchical memory management
- [Generative Agents](https://arxiv.org/abs/2304.03442) - Memory stream architecture
- OpenAI ChatGPT Memory - Discrete memory units
- Cognitive science literature on semantic/episodic/procedural memory systems
