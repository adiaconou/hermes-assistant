# Media-First Intent Resolution Plan

**Created:** February 12, 2026  
**Status:** Proposed

---

## Problem Statement

Hermes currently plans from text-first context, while current-turn images are represented to the planner as generic hints (for example, `[User sent an image]`) rather than structured image meaning. This causes incorrect intent resolution in common cases:

1. Deictic references fail: when a user says "generate a UI from this" with an attached image, "this" can resolve to prior conversation text instead of the new image.
2. Image-only turns are ambiguous: when a user sends only an image, planner routing is under-informed and may choose unrelated tasks.
3. Intent inference is inconsistent: explicit user intent, inferred image intent, and prior conversation state do not have a deterministic precedence policy.

This leads to wrong plans, wrong agent/tool selection, and reduced user trust.

---

## Goals

1. Ensure current-turn image content is available to planning before plan creation.
2. Support image-only requests with clarification-first handling when intent is unclear.
3. Resolve deictic references ("this", "that", "it") to current-turn media first when media exists.
4. Preserve deterministic orchestration, auditability, and safety guardrails.
5. Reuse existing infrastructure where possible (`analyze_image`, metadata persistence, orchestrator flow).
6. Force async orchestration for any inbound message that includes media attachments.

## Non-Goals

1. Replacing orchestrator planning with a single opaque one-shot model call.
2. Full multimodal understanding for every non-image file type in phase 1.
3. Large prompt architecture rewrites unrelated to media intent resolution.

---

## Existing System Gaps

1. `src/routes/sms.ts` builds a media hint for text context, but it does not provide semantic image content to the planner for the current turn.
2. `src/executor/tool-executor.ts` provides agent-level hints to use `analyze_image`, but this occurs after planning.
3. `src/orchestrator/media-context.ts` injects persisted prior-turn image metadata for agent prompts, not planner-time current-turn interpretation.
4. `src/tools/vision.ts` can analyze images well, but only when called by an agent after planner routing has already happened.

---

## First-Principles Design

1. Perceive before deciding: current-turn media should be summarized before planner call.
2. Structured planner inputs: use bounded structured media context, not only free-text hints.
3. Explicit-over-inferred policy: direct user text intent has highest precedence.
4. Clarification over guessing: if image-only intent is unclear, ask a short follow-up question.
5. Orchestrator remains control plane: keep planning + execution separation for reliability.
6. Reuse planner skill context: rely on existing `<available_agents>` instead of adding a separate intent/skill lookup stage.

---

## Proposed Architecture

### High-Level Flow

```
Inbound webhook (text + media)
  -> Parse and normalize attachments
  -> In parallel:
       Upload media to Drive (existing)
       Pre-analyze image attachments via Gemini (new, 5s/image timeout)
  -> Build structured <current_media> block from pre-analysis (new)
  -> Enrich planner input with text + <current_media> (new)
  -> Planner creates execution plan
  -> Agents execute tools (including deeper analyze_image if needed)
  -> Persist media metadata for future turns
```

### Planner Input Contract (New)

Add a compact `<current_media>` block in the planner-visible user input, containing per attachment:

1. `attachment_index`
2. `mime_type`
3. `category` (`receipt`, `data_table`, `chart`, `screenshot`, `photo`, `document`, `unknown`) (optional)
4. `summary` (2-3 bounded sentences)

All fields must be bounded and escaped before prompt injection.

### Intent Precedence Policy

1. Explicit user text intent
2. Current-turn media semantics (`<current_media>`)
3. Prior conversation references (`<conversation_history>`, `<media_context>`)

### Image-Only Handling Policy

1. If summary + user text clearly map to a task, proceed with normal planning.
2. If summary is ambiguous, ask a concise clarification question rather than inferring a specific action.
3. If the user sent only media with no clear task, ask whether they want extraction, explanation, or another action.
4. Multiple attachments: each gets its own `<current_media>` entry. The planner sees all summaries and decides how to address them together (e.g., "process these 3 receipts" vs. asking which one the user means).

### Pre-Analysis Failure Fallback

If pre-analysis fails (Gemini timeout, error, or unavailable), the message continues processing with the existing hint-only path. The user sees normal behavior — the planner routes based on text and history as it does today. No error is surfaced unless the entire message fails.

---

## Detailed Implementation Plan

### Phase M0: Contracts, Prompts, and Limits

**Files:**  
`src/services/conversation/types.ts`  
`src/orchestrator/planner.ts`  
`src/routes/sms.ts`  
`src/services/anthropic/classification.ts`  
`src/services/anthropic/prompts/classification.ts`

**Tasks:**
1. Define `CurrentMediaSummary` type for planner input.
2. Define serialization format for `<current_media>`.
3. Add hard caps for:
   - max attachments injected
   - max chars per summary
4. Add escaping/sanitization for planner-safe injection.
5. Update planner prompt rules for deictic binding and precedence.
6. Enforce routing rule: if inbound message has media attachments, classifier must set `needsAsyncWork=true`.

**Acceptance Criteria:**
1. Contract documented in code and tests.
2. Planner prompt includes explicit precedence rule.
3. Injection size limits are enforced.
4. Messages with media never stay on sync-only path.

### Phase M1: Pre-Analysis Before Planning

**Files:**
`src/services/media/upload.ts`
`src/services/google/vision.ts`
`src/orchestrator/handler.ts`
`src/routes/sms.ts`

**Latency Budget:**
- Hard timeout: 5s per image, 8s total for all attachments.
- If pre-analysis exceeds the timeout, fall back to the existing hint-only path (planner sees `[User sent an image]` as today).

**Tasks:**
1. In media upload flow, run pre-analysis for image buffers before planner invocation.
2. Run Drive upload and Gemini pre-analysis in parallel (they are independent).
3. If Drive auth/upload fails, return an explicit auth-required outcome and notify the user to re-authenticate.
4. Return composite result:
   - `stored: StoredMediaAttachment[]`
   - `preAnalysis: CurrentMediaSummary[]`
5. Use a single pre-analysis model call per attachment that returns bounded structured output:
   - `summary` (2-3 sentences, capped)
   - `category` (optional coarse type)
6. Add retry/backoff for transient pre-analysis model failures (upload path already has `fetchWithRetry()`).
7. Add logs for pre-analysis latency, success/failure rate, and fallback path.
8. Persist a pending retry record keyed by originating message when auth is required.
9. On successful OAuth callback, automatically retry upload + pre-analysis + orchestration once.

**Acceptance Criteria:**
1. Planner receives pre-analysis for successful image pre-analysis calls.
2. When Drive auth is missing, user receives a re-auth prompt and the original media message is queued for retry.
3. After re-auth, queued media message is retried automatically without user re-sending content.
4. Observability shows clear pre-analysis and auth-retry outcomes.

### Phase M2: Planner Enrichment and Deictic Resolution

**Files:**  
`src/routes/sms.ts`  
`src/orchestrator/handler.ts`  
`src/orchestrator/planner.ts`

**Tasks:**
1. Build enriched message payload for planner:
   - original user text
   - existing media hint (optional)
   - `<current_media>` block
2. Update planner rules:
   - resolve "this/that/it" to current-turn media when available
   - only fall back to history if current-turn media is absent
3. Keep deterministic fallback when media analysis is unavailable.

**Acceptance Criteria:**
1. "Generate a UI from this" + table image routes to fetch/transform -> ui-agent path.
2. Prior conversation content no longer overrides current attached media in these cases.
3. Text-only behavior remains unchanged.

### Phase M3: Image-Only Clarification Flow

**Files:**  
`src/orchestrator/planner.ts`  
`src/routes/sms.ts`

**Tasks:**
1. Add planner rule: do not assume a specific action for ambiguous image-only turns.
2. Add concise clarification templates for ambiguous image-only input.
3. Keep behavior deterministic: if no clear task can be inferred, always ask a clarification question.
4. Keep existing planner skill/agent selection path; do not add a separate skill lookup stage.

**Acceptance Criteria:**
1. Image-only receipt with clear user task routes correctly (e.g., extraction request).
2. Ambiguous image-only input produces concise clarifying question.
3. No new separate intent-resolution stage is introduced.

### Phase M4: Multi-Turn Continuity Alignment

**Files:**  
`src/services/conversation/sqlite.ts`  
`src/orchestrator/media-context.ts`  
`src/tools/vision.ts`

**Tasks:**
1. Persist current-turn pre-analysis summary metadata per message.
2. Keep existing deep `image_analysis` metadata path from tool execution.
3. Avoid duplication across `<current_media>` and persisted `<media_context>` paths.
4. Ensure prompt composition remains bounded for long conversations.
5. Persist only compact fields for pre-analysis metadata (category, short summary, attachment index).
6. Do not persist full OCR-style raw extraction in pre-analysis metadata.

**Acceptance Criteria:**
1. Current turn routing works without requiring prior persistence.
2. Follow-up turns can reference prior images reliably.
3. Prompt size remains within configured limits.
4. Persisted pre-analysis metadata remains compact and bounded.

### Phase M5: Testing and Rollout

**Files:**  
`tests/unit/routes/sms.test.ts`  
`tests/unit/services/media/upload.test.ts`  
`tests/unit/orchestrator/planner.test.ts`  
`tests/integration/` (media + orchestrator scenarios)

**Tasks:**
1. Unit tests for payload shaping, limits, and sanitization.
2. Unit tests for precedence and deictic rules.
3. Unit tests for image-only clarification behavior.
4. Integration tests for:
   - explicit intent + image
   - image-only clarification flow
   - false reference regression (history vs current media)

**Acceptance Criteria:**
1. `npm run test:unit` passes.
2. `npm run test:integration` passes.
3. Routing regressions are covered by tests.
4. Re-auth + automatic retry flow is covered by tests.

---

## Rollout Plan

1. Introduce env var: `MEDIA_FIRST_PLANNING_ENABLED` (default `false`).
2. Enable locally, validate with real SMS/WhatsApp messages.
3. Deploy to production with flag enabled.
4. Remove old hint-only planner path after stability window (1-2 weeks).

---

## Risk Assessment and Mitigations

1. Increased latency from pre-analysis.
   - Mitigation: 5s per-image / 8s total timeout, parallel upload + pre-analysis, fallback to hint-only path on timeout.
2. Incorrect inferred intent from ambiguous image-only turns.
   - Mitigation: clarification-first policy (ask, do not guess).
3. Prompt bloat.
   - Mitigation: hard caps and truncation strategy for summaries.
4. Duplicate or conflicting context.
   - Mitigation: strict precedence policy and deduplicated prompt composer.

---

## Open Decisions

None — all decisions resolved.

## Locked Decisions (February 12, 2026)

1. Any inbound message with media must run the async orchestration path.
2. If Drive auth/upload fails, Hermes must prompt for re-auth, queue the original message, and auto-retry after OAuth success.
3. Pre-analysis summaries should be persisted as compact metadata for multi-turn continuity, while keeping payloads bounded and excluding full raw OCR extraction.
4. Phase 1 uses a single pre-analysis prompt/call (summary + optional category) to minimize latency and cost.
5. Hermes should rely on existing planner skill/agent context for routing, not a separate post-summary skill lookup stage.
6. Non-image files (PDF/doc) are excluded from pre-analysis in phase 1. The `CurrentMediaSummary` type includes `mime_type` so phase 2 can extend without breaking the contract.

---

## Architecture Doc Check

When implementation begins, update `ARCHITECTURE.md` if any of the following changes are made:

1. Planner input contract or precedence rules.
2. New media analysis pipeline stages.
3. New metadata fields/tables for current-turn media summaries.
4. New clarification behavior for ambiguous image-only turns.
