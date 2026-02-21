# Reliability

System reliability patterns, timeout budgets, retry strategies, and graceful degradation.

---

## Timeout Budgets

| Component | Timeout | Purpose |
|-----------|---------|---------|
| Sync classifier | <5 seconds | Must return TwiML before Twilio times out |
| Async orchestration | 5 minutes | Max total time for plan → execute → replan → compose |
| Per-step timeout | 2 minutes | Prevent stuck agents from blocking the pipeline |
| Twilio media download | 30 seconds | Timeout for downloading MMS/WhatsApp attachments |

## Retry Strategies

| Component | Strategy | Max Retries |
|-----------|----------|-------------|
| Agent step execution | Retry on failure before replanning | 2 per step |
| Replanning | Create revised plan on step failure | 3 total replans |
| Twilio media download | Retry with exponential backoff on transient failures | 3 |
| Memory extraction batch | Failed batches retry next cycle | Implicit (5-min cycles) |

## Graceful Degradation

| Failure | Fallback |
|---------|----------|
| Classifier fails | Message goes directly to orchestrator (assumes async work needed) |
| Plan JSON parse fails | Repair LLM call attempts to fix the JSON |
| Plan repair fails | Falls back to general-agent for the entire request |
| Pre-analysis (Gemini) fails | Continues with empty pre-analysis array — planner works without it |
| Media download fails | Continues without media — user gets a response about the text content |
| Individual step fails after retries | Replanner creates an adjusted plan |
| All replans exhausted | Composer synthesizes a partial response from completed steps |
| Background memory extraction fails | Retries next cycle; messages stay marked as unprocessed |
| Email watcher poll fails | Retries next cycle; historyId preserved for incremental sync |
| Gmail historyId expires | Watcher resets from current profile; notifies user |

## Background Process Resilience

All three background processes (scheduler, memory, email watcher) are designed to be crash-safe:

- **Scheduler poller** (30s): One-time jobs are deleted only after successful execution. If the process crashes mid-execution, the job remains and will be re-attempted.
- **Memory processor** (5min): Messages are marked as processed only after successful extraction. Failed batches retain `memory_processed = 0` and retry next cycle.
- **Email watcher** (60s): Uses Gmail `historyId` as an incremental cursor. If a poll fails, the cursor doesn't advance, so emails aren't skipped.

## SMS Delivery

- Outbound SMS uses Twilio REST API — delivery is best-effort (no delivery receipts tracked)
- Notification throttling: max 10 SMS per user per hour (email watcher)
- Multi-segment messages (>160 chars) cost more — see [tech-debt-tracker](exec-plans/tech-debt-tracker.md) T-29

## Known Reliability Gaps

See [tech-debt-tracker](exec-plans/tech-debt-tracker.md) for the full list. Key items:
- T-04: Silent orchestration failures (no user notification)
- T-06: Step timeout not fully enforced
- T-08: No retry logic for Google API transient failures
