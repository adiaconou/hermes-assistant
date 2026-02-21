# Memory Agent Routing Plan

Goal: make the memory agent the dedicated, low‑noise path for explicit “remember / recall / forget” requests, while keeping the background memory processor unchanged and retaining general-agent as fallback.

## Current State (summary)
- Classifier can short-circuit memory intents with needsAsyncWork=false, so no tools run.
- Planner favors general-agent for simple requests; memory-agent is rarely selected.
- General-agent already has memory tools, so the dedicated agent offers little practical value today.
- Background processor extracts facts asynchronously; it does not depend on the memory agent.

## Requirements
Functional
- Route explicit memory intents to memory-agent (or general-agent as fallback) so memory tool calls actually run.
- Explicit “remember” writes should store facts immediately with confidence=1.0 and return a confirmation within SMS limits.
- “What do you know about me?” should list top N facts (bounded length) via tools, not the background processor.
- “Forget/delete/update” should modify the store and confirm the change.
- Do not change background processor behavior or schema.
- Preserve multi-user isolation; no cross-user leakage.
- Maintain Twilio SMS length guardrails for immediate responses.
- Intent detection must be LLM-driven (no regex/keyword heuristics).

Non-functional
- Add automated tests for classifier, planner agent selection, and tool execution path.
- Keep behavior backward compatible for non-memory messages.
- Minimal diff risk: avoid schema changes or new env vars.
- Update documentation: MEMORY.md (behavioral note) + release note in CHANGELOG if present.

Out of Scope
- Embedding-based duplicate detection.
- UI/admin changes.
- New schema or storage backends.

## Design Overview
1) Intent detection (classifier LLM)
   - Strengthen the classification prompt so the LLM itself flags memory intents (remember/recall/forget/update/“what do you know about me”) and sets needsAsyncWork=true.
   - Keep immediateResponse a short acknowledgment (e.g., “Working on that memory request.”) to stay under SMS limits.

2) Planning bias
   - In the planning prompt, instruct: “For memory store/recall/delete tasks, use memory-agent.”
   - Reorder agent list so memory-agent is listed before general-agent (ties break earlier).
   - Optional: lightweight pre-plan override—if the user message is tagged as memory intent, seed a single-step plan with memory-agent unless the planner produces something more specific.

3) Execution behavior
   - Memory-agent continues to use existing tools (extract_memory, list_memories, update_memory, remove_memory).
   - Keep general-agent as fallback; if memory-agent is unavailable, general-agent can still perform the tools.
   - Response templates: brief confirmations; include fact counts for list operations; keep replies concise for SMS.

4) Confidence and dedup
   - Explicit writes keep confidence=1.0 (existing tool behavior).
   - No change to background reinforcement logic; avoid double-writing by respecting tool idempotency (same fact text is allowed; processor dedup handles inference side).

5) Logging/observability
   - Add classifier log field memoryIntent:boolean.
   - Consider a metric counter for memory-agent invocations vs general-agent memory tool calls (optional).

## Step-by-Step Implementation Plan
1. Classification updates
   - Modify buildClassificationPrompt to explicitly instruct the LLM to treat memory-oriented messages as async (needsAsyncWork=true) and to return brief acknowledgments.
   - Add unit tests that mock LLM responses: memory intents → needsAsyncWork true; non-memory control → false.

2. Planner bias
   - Update planner prompt rules to state: “Use memory-agent for memory storage/recall/delete tasks.”
   - Ensure agent list ordering places memory-agent before general-agent.
   - Add unit tests: planner chooses memory-agent for “Remember I like tea”; still chooses general-agent for non-memory tasks.

3. (Optional safety) Pre-plan guard
   - If classifier flagged memory intent, short-circuit to a single-step plan targeting memory-agent with the original task. Keep planner path as default so this is a minimal patch; only add if planner changes aren’t sufficient.

4. Agent prompt tweaks
   - In memory-agent prompt, emphasize confirmations and SMS brevity; remind to avoid duplicates in wording but let store handle them.
   - Add a short note: “If listing, cap to 20 facts and keep under 1500 chars.”

5. Tool edge-case handling
   - Ensure list_memories respects limit input (already slices); add test to confirm limit is enforced and bounded to 100.
   - No schema changes needed.

6. Tests
   - Unit: classifier memory intent → needsAsyncWork true.
   - Unit: planner selects memory-agent for memory tasks.
   - Unit: tool-executor includes memory XML when facts present (already exists; keep).
   - Integration: simulate SMS “Remember I like coffee” → orchestrator runs memory tool and returns confirmation; message stored.

7. Docs
   - Update MEMORY.md “explicit path” section to note that memory-agent handles explicit requests; general-agent is fallback.
   - Add a short note in ARCHITECTURE.md if agent routing rules change.

8. Rollout
   - No feature flag proposed; change is low risk.
   - Monitor logs for memoryIntent and memory-agent invocation counts after deploy.

## Open Questions
- Do we want a feature flag to disable the memory-agent bias in production quickly?
- Should the classifier ever return needsAsyncWork=false for read-only “what do you know about me?” to keep it synchronous? (Current plan routes async for consistency.) 
- Do we need a stricter character cap on list responses beyond the existing tool-executor caps? 
