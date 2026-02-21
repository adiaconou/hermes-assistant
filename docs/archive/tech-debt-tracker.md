# Tech Debt Tracker

Synthesized from [25-project-review](completed/25-project-review.md) and [30-architectural-review](completed/30-architectural-review.md). Cross-referenced with [architectural-fixes](completed/architectural-fixes.md) (implementation plan, not yet executed).

---

## Open Items

### Critical

| ID | Area | Description | Source |
|----|------|-------------|--------|
| T-01 | Database | Connection leak in admin routes — each handler creates unclosed Database instance. Resource exhaustion risk. | Review #30, Issue #1 |
| T-02 | Security | Twilio signature validation missing on `/webhook/sms` — unauthenticated webhook = cost + security risk. | Review #25, Issue #1 |

### High

| ID | Area | Description | Source |
|----|------|-------------|--------|
| T-03 | Database | Scheduler DB connection never closed on shutdown. In-flight jobs may corrupt data. | Review #30, Issue #2 |
| T-04 | Error Handling | Fire-and-forget async orchestration — user sees "working on it" but never gets response if orchestration fails silently. | Review #30, Issue #3 |
| T-05 | OAuth | Channel lost through OAuth flow — WhatsApp users may receive SMS or vice versa. State payload only stores `{phone, exp}`. | Review #25, Issue #2 |

### Medium

| ID | Area | Description | Source |
|----|------|-------------|--------|
| T-06 | Timeouts | Timeout enforcement inconsistent — defined but not enforced everywhere. Step timeout can be exceeded by tool loops. | Review #30, Issue #4 |
| T-07 | Performance | Triple fallback cascade in planning: LLM parse → repair call → general agent. Up to 2 extra LLM calls. | Review #30, Issue #11 |
| T-08 | APIs | No retry logic for external Google APIs — transient 5xx errors propagate immediately. Need exponential backoff. | Review #30, Issue #13 |
| T-09 | Message Handling | Double continuation message injection after OAuth. | Review #25, Issue #3 |

### Low

| ID | Area | Description | Source |
|----|------|-------------|--------|
| T-10 | Logic | Replan signal detection scattered across 3 files. Unclear when replanning happens. | Review #30, Issue #5 |
| T-11 | Database | Multiple Database instances to same file (credentials.db). Lock contention risk. | Review #30, Issue #6 |
| T-12 | Code Quality | Inconsistent try-catch patterns — 4 different error handling styles across 42 files. | Review #30, Issue #7 |
| T-13 | Date Logic | Date resolution duplicated during replanning — "Friday" may resolve differently. | Review #30, Issue #8 |
| T-14 | Database | False async methods — SQLite operations block event loop for large batches. | Review #30, Issue #12 |
| T-15 | Database | Overloaded credentials.db — 5 tables mixing encrypted tokens with plaintext config. | Review #30, Issue #14 |
| T-16 | Logging | 3 parallel logging systems with inconsistent formats. Debugging difficulty. | Review #30, Issue #15 |
| T-17 | Data | User config duplicated in email_watcher_state AND user_config table. Two sources of truth. | Review #30, Issue #16 |
| T-18 | Database | Schema migration duplication — PRAGMA-based column detection repeated in 3+ files. | Review #30, Issue #17 |
| T-19 | Orchestrator | Agent context assembled inconsistently — field names vary across executor/replanner/composer. | Review #30, Issue #18 |
| T-20 | Types | Step results format inconsistency — `Record<string, StepResult>` vs `Array<{id, output}>`. | Review #30, Issue #19 |
| T-21 | Agent Tools | Tool filtering happens AFTER agent prompt built — agents may reference filtered-out tools. | Review #30, Issue #20 |
| T-22 | Code Quality | Response composer tool loop duplicates tool-executor logic (30-40 lines). DRY violation. | Review #30, Issue #21 |
| T-23 | Configuration | Magic numbers scattered across files vs central config.ts. Hard to understand full config. | Review #30, Issue #22 |
| T-24 | Configuration | Hardcoded model IDs in 6+ files. Maintenance burden. | Review #30, Issue #23 |
| T-25 | Prompts | Prompt management inconsistent — static prompts vs dynamic builders, no shared templates. | Review #30, Issue #24 |
| T-26 | Configuration | Unclear which env vars are required vs optional — some throw, some silently default. | Review #30, Issue #25 |
| T-27 | Code Quality | Unused S3 storage provider stub — dead code, unnecessary abstraction. | Review #30, Issue #26 |
| T-28 | Code Quality | Phone number normalization duplicated in 5+ files with different implementations. | Review #30, Issue #27 |
| T-29 | SMS | SMS length limits not enforced for sync TwiML responses — multi-segment cost. | Review #25, Issue #4 |
| T-30 | Cryptography | Crypto decode uses string concatenation instead of `Buffer.concat()` — edge case with multi-byte UTF-8. | Review #25, Issue #5 |

---

## Deferred (Not Priority for Personal Assistant)

| ID | Area | Description | Source |
|----|------|-------------|--------|
| T-D1 | Security | Admin routes lack authentication. | Review #30, Issue #9 |
| T-D2 | Security | No rate limiting on webhooks. | Review #30, Issue #10 |

---

## Resolved Items

| ID | Area | Description | Resolved In |
|----|------|-------------|-------------|
| — | — | No items resolved yet. architectural-fixes plan exists but has not been executed. | — |

---

## Implementation Plan Reference

The [architectural-fixes](completed/architectural-fixes.md) execution plan covers these items in phases:

| Phase | Focus | Items |
|-------|-------|-------|
| Phase 1 (Critical) | DB leaks, scheduler cleanup | T-01, T-03 |
| Phase 2 (Reliability) | Error handling, retries, timeouts | T-04, T-08, T-06 |
| Phase 3 (Performance) | Planning simplification, logging | T-07, T-12, T-16 |
| Phase 4 (Tech Debt) | All remaining low-severity items | T-10 through T-30 |
