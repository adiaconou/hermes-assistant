# Documentation Restructure Plan

## Goal

Migrate from flat numbered `docs/XX-*.md` structure to a categorized folder hierarchy modeled after the Harness engineering documentation pattern. The new structure separates concerns into design docs, execution plans, product specs, references, and generated artifacts, with top-level guidance documents.

---

## Target Structure

```
AGENTS.md                          ← Keep as-is (Claude Code instructions)
ARCHITECTURE.md                    ← Keep as-is (system design reference)
README.md                          ← Keep as-is (project overview)
CLAUDE.md                          ← Keep as-is (pointer to AGENTS.md)
docs/
├── design-docs/
│   ├── index.md
│   ├── core-beliefs.md
│   ├── agent-architecture.md
│   ├── orchestrator-design.md
│   ├── ui-generation.md
│   ├── ui-validation-approach.md
│   ├── gcal-integration.md
│   ├── cron-jobs.md
│   ├── gmail-integration.md
│   ├── memory-admin-ui.md
│   ├── unified-date-resolver.md
│   ├── user-config-store.md
│   ├── google-workspace-integration.md
│   ├── image-analysis-persistence.md
│   ├── email-watcher-design.md
│   ├── media-first-intent-resolution.md
│   └── skills-system-design.md
├── exec-plans/
│   ├── active/
│   │   └── skills-system-implementation.md
│   ├── completed/
│   │   ├── phase-1-sms-mvp.md
│   │   ├── phase-2-whatsapp.md
│   │   ├── phase-3-llm-integration.md
│   │   ├── llm-module-refactoring.md
│   │   ├── orchestrator-implementation.md
│   │   ├── calendar-update-delete.md
│   │   ├── one-time-reminders.md
│   │   ├── update-reminders-fix.md
│   │   ├── memory-phase-1-implementation.md
│   │   ├── async-memory-processing.md
│   │   ├── memory-prompt-enhancement.md
│   │   ├── memory-agent-routing.md
│   │   ├── email-watcher-implementation.md
│   │   ├── architectural-fixes.md
│   │   └── media-first-implementation.md
│   └── tech-debt-tracker.md
├── generated/
│   └── db-schema.md
├── product-specs/
│   ├── index.md
│   ├── master-prd.md
│   └── memory-prd.md
├── references/
│   └── (empty — to be populated as needed)
├── DESIGN.md
├── FRONTEND.md
├── PLANS.md
├── PRODUCT_SENSE.md
├── QUALITY_SCORE.md
├── RELIABILITY.md
└── SECURITY.md
```

---

## File Migration Map

### Root-level files (no change)

| File | Action |
|------|--------|
| `AGENTS.md` | Keep as-is |
| `ARCHITECTURE.md` | Keep as-is |
| `README.md` | Keep as-is |
| `CLAUDE.md` | Keep as-is |

### docs/ → design-docs/

Design docs capture **architectural decisions, system design rationale, and technical approach**. They answer "why" and "how" at a design level.

| Current File | New Location | Notes |
|---|---|---|
| `08-agent-architecture.md` | `design-docs/agent-architecture.md` | Multi-agent architecture design |
| `09-orchestrator-design.md` | `design-docs/orchestrator-design.md` | Orchestrator system design |
| `06-phase-4-ui-generation.md` | `design-docs/ui-generation.md` | UI generation system design |
| `07-ui-validation-approach.md` | `design-docs/ui-validation-approach.md` | UI self-validation design |
| `11-phase-5-gcal-integration.md` | `design-docs/gcal-integration.md` | Google Calendar integration design |
| `13-cron-jobs.md` | `design-docs/cron-jobs.md` | Scheduled task design |
| `16-gmail-integration.md` | `design-docs/gmail-integration.md` | Gmail read-only access design |
| `22-memory-admin-ui.md` | `design-docs/memory-admin-ui.md` | Memory admin web interface design |
| `23-unified-date-resolver.md` | `design-docs/unified-date-resolver.md` | Date resolution consolidation design |
| `24-user-config-store.md` | `design-docs/user-config-store.md` | User preferences storage design |
| `26-google-workspace-integration.md` | `design-docs/google-workspace-integration.md` | Drive/Sheets/Docs/Vision design |
| `27-image-analysis-persistence.md` | `design-docs/image-analysis-persistence.md` | Image metadata persistence design |
| `28-email-watcher-design.md` | `design-docs/email-watcher-design.md` | Email watcher + skill classification design |
| `32-media-first-intent-resolution-plan.md` | `design-docs/media-first-intent-resolution.md` | Media-first planning design |
| `33-skills-system-design.md` | `design-docs/skills-system-design.md` | Skills system refactor design |

### docs/ → exec-plans/completed/

Exec plans are **concrete implementation plans with steps, file changes, and verification criteria**. All of these have been implemented.

| Current File | New Location | Notes |
|---|---|---|
| `02-phase-1-sms-mvp.md` | `exec-plans/completed/phase-1-sms-mvp.md` | SMS echo PoC |
| `03-phase-2-whatsapp.md` | `exec-plans/completed/phase-2-whatsapp.md` | WhatsApp support |
| `04-phase-3-llm-integration.md` | `exec-plans/completed/phase-3-llm-integration.md` | Claude API integration |
| `05-llm-module-refactoring.md` | `exec-plans/completed/llm-module-refactoring.md` | Monolith → modular refactor |
| `10-orchestrator-implementation.md` | `exec-plans/completed/orchestrator-implementation.md` | Orchestrator buildout |
| `12-calendar-update-delete.md` | `exec-plans/completed/calendar-update-delete.md` | Calendar CRUD tools |
| `14-one-time-reminders.md` | `exec-plans/completed/one-time-reminders.md` | One-time reminder support |
| `15-update-reminders-fix.md` | `exec-plans/completed/update-reminders-fix.md` | Reminder update bug fix |
| `18-memory-phase-1-implementation.md` | `exec-plans/completed/memory-phase-1-implementation.md` | Memory system Phase 1 |
| `19-async-memory-processing.md` | `exec-plans/completed/async-memory-processing.md` | Background memory extraction |
| `20-memory-prompt-enhancement.md` | `exec-plans/completed/memory-prompt-enhancement.md` | Smart memory extraction |
| `21-memory-agent-routing.md` | `exec-plans/completed/memory-agent-routing.md` | Memory agent intent routing |
| `29-email-watcher-implementation.md` | `exec-plans/completed/email-watcher-implementation.md` | Email watcher buildout |
| `31-implementation-plan.md` | `exec-plans/completed/architectural-fixes.md` | Fixes from architectural review |

### docs/ → exec-plans/active/

Plans for features not yet implemented.

| Current File | New Location | Notes |
|---|---|---|
| `33-skills-system-design.md` (implementation plan section) | `exec-plans/active/skills-system-implementation.md` | Extract the "Implementation Plan" section from the skills design doc into a standalone exec plan. The design portion stays in `design-docs/skills-system-design.md`. |

### docs/ → product-specs/

Product specs define **what** to build — user stories, requirements, feature definitions.

| Current File | New Location | Notes |
|---|---|---|
| `01-master-prd.md` | `product-specs/master-prd.md` | Master product requirements |
| `17-memory-prd.md` | `product-specs/memory-prd.md` | Memory system requirements |

### docs/ → exec-plans/tech-debt-tracker.md (new, synthesized)

Consolidate findings from the two review documents into a living tech debt tracker.

| Source File | Action |
|---|---|
| `25-project-review.md` | Extract unresolved findings into tech-debt-tracker.md, then delete original |
| `30-architectural-review.md` | Extract unresolved findings into tech-debt-tracker.md, then delete original |

### Deleted files

| File | Reason |
|------|--------|
| `00-reorganization-summary.md` | Meta-doc about the previous renaming. No longer relevant after this restructure. |
| `25-project-review.md` | Content absorbed into `exec-plans/tech-debt-tracker.md` |
| `30-architectural-review.md` | Content absorbed into `exec-plans/tech-debt-tracker.md` |

---

## New Files to Create

### 1. `docs/design-docs/index.md`

Index of all design docs. For each entry: title, one-line description, link. Organized by subsystem (core architecture, integrations, memory, media, etc.).

### 2. `docs/design-docs/core-beliefs.md`

Extract and consolidate the project's core design philosophy from existing docs:
- Design principles from `AGENTS.md` ("Avoid over-engineering", "Prefer explicit over clever", etc.)
- Key architectural decisions from `ARCHITECTURE.md` (two-phase response, tool isolation, background memory, timezone-first)
- The "why" behind major patterns (agent orchestration over monolithic LLM, SQLite over Postgres, etc.)

### 3. `docs/product-specs/index.md`

Index of all product specs with links and one-line descriptions.

### 4. `docs/exec-plans/tech-debt-tracker.md`

Living document synthesized from `25-project-review.md` and `30-architectural-review.md`. Format:

```markdown
# Tech Debt Tracker

## Open Items
| ID | Area | Description | Severity | Source | Status |
|----|------|-------------|----------|--------|--------|

## Resolved Items
| ID | Area | Description | Resolved In |
|----|------|-------------|-------------|
```

Review both source docs, cross-reference with `31-implementation-plan.md` (which addresses many of the findings), and mark items as either Open or Resolved.

### 5. `docs/generated/db-schema.md`

Auto-generate from the SQLite schema definitions in the codebase. Include:
- All 3 databases (credentials.db, conversation.db, memory.db)
- All tables with column definitions
- Extracted from `src/services/*/sqlite.ts` CREATE TABLE statements

### 6. `docs/DESIGN.md`

Top-level design guidance document. Covers:
- Architectural overview (pointer to ARCHITECTURE.md for details)
- Key design patterns used in the codebase (two-phase SMS, agent orchestration, tool isolation)
- How to think about adding new features (when to create a new agent vs. extend an existing one)
- Cross-cutting concerns (date handling, memory injection, conversation windowing)
- Links to relevant design-docs/ for deep dives

### 7. `docs/FRONTEND.md`

Frontend and UI concerns:
- UI agent capabilities and constraints (no network access, data must be pre-fetched)
- Admin pages (`/admin/memory`, `/admin/email-skills`)
- Generated UI pages (storage providers, validation, short URLs)
- HTML/CSS/JS constraints for generated pages (CSP headers, self-contained)

### 8. `docs/PLANS.md`

Overview of active and recently completed execution plans:
- Links to `exec-plans/active/` docs
- Summary of recently completed plans
- How to write a new exec plan (lightweight template)

### 9. `docs/PRODUCT_SENSE.md`

Product direction and user context:
- Product vision (from master PRD)
- Current capabilities summary
- User interaction patterns (SMS-first, two-phase response UX)
- What makes a good feature for this product (SMS-friendly, async-tolerant, etc.)
- Future roadmap themes

### 10. `docs/QUALITY_SCORE.md`

Quality standards and measurement:
- Test requirements (from AGENTS.md)
- Test coverage expectations by area
- Code quality checklist (from AGENTS.md coding guidelines)
- Build/lint/test verification commands
- What "done" looks like for a feature

### 11. `docs/RELIABILITY.md`

System reliability concerns:
- Timeout budgets (sync <5s, async <5min, per-step 2min)
- Retry strategies (step retries, replan on failure, media download retries)
- Graceful degradation (pre-analysis failure → empty array, classifier failure → orchestrator)
- Background process resilience (scheduler, memory processor, email watcher)
- Rate limiting and throttling (SMS notification throttle, conversation window caps)

### 12. `docs/SECURITY.md`

Security practices:
- Credential management (encrypted OAuth tokens, CREDENTIAL_ENCRYPTION_KEY)
- Input validation (Twilio signature validation, webhook payload verification)
- No-log policy for sensitive data
- CSP headers for generated UI pages
- Environment variable management
- Phone number as identity (no multi-user auth yet)

---

## Implementation Steps

### Phase 1: Create folder structure

```bash
mkdir -p docs/design-docs
mkdir -p docs/exec-plans/active
mkdir -p docs/exec-plans/completed
mkdir -p docs/generated
mkdir -p docs/product-specs
mkdir -p docs/references
```

### Phase 2: Move existing files

Move files according to the migration map above. Use `git mv` to preserve history. Strip numeric prefixes from filenames during the move.

### Phase 3: Create new index and guidance docs

1. `docs/design-docs/index.md` — Index of design docs
2. `docs/design-docs/core-beliefs.md` — Core design philosophy
3. `docs/product-specs/index.md` — Index of product specs
4. `docs/exec-plans/tech-debt-tracker.md` — Synthesize from reviews
5. `docs/generated/db-schema.md` — Extract from codebase

### Phase 4: Create top-level guidance docs

1. `docs/DESIGN.md`
2. `docs/FRONTEND.md`
3. `docs/PLANS.md`
4. `docs/PRODUCT_SENSE.md`
5. `docs/QUALITY_SCORE.md`
6. `docs/RELIABILITY.md`
7. `docs/SECURITY.md`

### Phase 5: Split the skills system design doc

The `33-skills-system-design.md` contains both design rationale and an implementation plan. Split it:
- Design sections ("Problem", "Current State", "Proposed Design", "Key Design Decisions") → `design-docs/skills-system-design.md`
- Implementation sections ("Implementation Plan", "Files Summary", "Verification") → `exec-plans/active/skills-system-implementation.md`

### Phase 6: Update cross-references

- Update any internal links between docs that reference old paths
- Update `AGENTS.md` doc maintenance table if it references specific doc paths
- Update `CLAUDE.md` if it references doc paths

### Phase 7: Delete obsolete files

- `docs/00-reorganization-summary.md`
- `docs/25-project-review.md` (after absorbing into tech-debt-tracker)
- `docs/30-architectural-review.md` (after absorbing into tech-debt-tracker)

### Phase 8: Verify

- All files accounted for (no orphaned docs in `docs/`)
- All internal cross-references resolve
- `git status` shows clean renames (not delete+create)

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Files moved to `design-docs/` | 15 |
| Files moved to `exec-plans/completed/` | 14 |
| Files moved to `exec-plans/active/` | 1 |
| Files moved to `product-specs/` | 2 |
| New files to create | 12 |
| Files to delete | 3 |
| Files split | 1 (skills system → design + exec plan) |
| Root files unchanged | 4 (AGENTS.md, ARCHITECTURE.md, README.md, CLAUDE.md) |

---

## Open Questions

1. **references/ folder**: Currently empty. Should we seed it with any external reference docs (e.g., nixpacks config reference, Twilio API reference, chrono-node docs)? Or leave empty and populate organically?

2. **33-skills-system-design.md split**: The design and implementation plan are tightly coupled in this doc. Is a clean split worthwhile, or should we keep it as one file in `design-docs/` and just add a pointer from `exec-plans/active/`?

3. **Review doc absorption**: Should the full text of `25-project-review.md` and `30-architectural-review.md` be preserved somewhere (e.g., as appendices to the tech debt tracker), or is a synthesized summary sufficient?
