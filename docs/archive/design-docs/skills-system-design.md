# Skills System Design

## Problem

The codebase has an "email skills" concept — per-user automation rules that the email watcher uses to classify and act on incoming emails. Three default skills (tax-tracker, expense-tracker, invite-detector) are seeded per user, and users can create custom ones via SMS tools.

This design is email-specific, but the underlying pattern (match → extract → act) applies to other invocation sources:

1. **User messages** — a user texts something that matches a skill, and the skill executes directly, bypassing the full orchestrator pipeline
2. **Scheduled jobs** — a cron job references a skill by name for periodic execution
3. **Email** — the existing path (email watcher classifies incoming emails against skills)

The goal is to refactor "email skills" into a first-class **Skills** system that supports all three invocation sources, while keeping the email watcher as just one consumer.

## Current State

### Where the code lives today

| Component | File | What it does |
|---|---|---|
| Types | `src/services/email-watcher/types.ts` | `EmailSkill` interface + email-specific types (IncomingEmail, ClassificationResult) |
| SQLite store | `src/services/email-watcher/sqlite.ts` | `EmailSkillStore` class — CRUD for `email_skills` table, singleton via `getEmailSkillStore()` |
| Default skills | `src/services/email-watcher/skills.ts` | `DEFAULT_SKILLS[]` array (tax-tracker, expense-tracker, invite-detector), `seedDefaultSkills()`, `validateSkillDefinition()` |
| Classifier | `src/services/email-watcher/classifier.ts` | LLM-based email-to-skill matcher, calls `getEmailSkillStore()` directly |
| Actions | `src/services/email-watcher/actions.ts` | `executeSkillActions()` — runs matched skills (tool execution or notification), `executeToolAction()` |
| Prompt builder | `src/services/email-watcher/prompt.ts` | `buildClassifierPrompt()` — takes `EmailSkill[]` |
| SMS tools | `src/tools/email-skills.ts` | 6 tools: `create_email_skill`, `list_email_skills`, `update_email_skill`, `delete_email_skill`, `toggle_email_watcher`, `test_email_skill` |
| Tool registry | `src/tools/index.ts` | Imports and registers all 6 tools from `./email-skills.js` |
| Agent | `src/agents/email/index.ts` | `EMAIL_TOOLS` array includes all 6 email skill tool names |
| Agent prompt | `src/agents/email/prompt.ts` | References `create_email_skill` in instructions |
| Admin API | `src/admin/email-skills.ts` | REST endpoints at `/admin/api/email-skills/*`, uses `getEmailSkillStore()` |
| Admin UI | `src/admin/views/email-skills.html` | Web UI, fetches from `/admin/api/email-skills/*` |
| Admin router | `src/admin/index.ts` | Mounts routes at `/admin/email-skills`, imports from `./email-skills.js` |

### Key interfaces

```typescript
// src/services/email-watcher/types.ts
interface EmailSkill {
  id: string;
  phoneNumber: string;
  name: string;              // slug format
  description: string;
  matchCriteria: string;     // natural language
  extractFields: string[];
  actionType: 'execute_with_tools' | 'notify';
  actionPrompt: string;
  tools: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
```

```sql
-- src/services/email-watcher/sqlite.ts
CREATE TABLE email_skills (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  match_criteria TEXT NOT NULL,
  extract_fields TEXT,        -- JSON array
  action_type TEXT NOT NULL,
  action_prompt TEXT NOT NULL,
  tools TEXT,                 -- JSON array
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(phone_number, name)
);
```

### How execution works today

**Email watcher** (`src/services/email-watcher/index.ts`):
```
For each enabled user:
  syncNewEmails() → IncomingEmail[]
  classifyEmails() → ClassificationResult[] (LLM-based, Sonnet 4.5)
  executeSkillActions()
    ├─ execute_with_tools → executeToolAction() → executeWithTools() (agentic tool loop)
    └─ notify → send SMS with match summary
```

**Tool execution** (`src/services/email-watcher/actions.ts`):
- `executeToolAction()` builds a task prompt from the skill's `actionPrompt` + extracted data + email metadata
- Calls `executeWithTools()` from `src/executor/tool-executor.ts` (the shared agentic loop, max 5 iterations)
- Returns a summary string

**Scheduler** (`src/services/scheduler/executor.ts`):
- Has no awareness of skills
- Executes a stored `prompt` via `executeWithTools()` with `READ_ONLY_TOOLS`
- Cannot invoke skills by name

**SMS flow** (`src/routes/sms.ts`):
- Two-phase: sync classifier → async orchestrator
- Has no skill matching — all messages go through the full orchestrator pipeline

---

## Proposed Design

### Core Concepts

**Deployed skills** — TypeScript modules shipped with the codebase, available to all users. Defined in `src/skills/deployed/*.ts`. These are the "default" skills (tax-tracker, etc.) and future built-in skills.

**Runtime skills** — User-created skills stored in the `skills` DB table. Created via SMS tools or admin UI. Per-user, per-phone.

**Skill registry** — Merges deployed + runtime skills. Runtime skills with the same name as a deployed skill override it (user customization).

**Invocation sources** — Where a skill can be triggered from:
- `matchOnEmail: true` — email watcher uses this skill for classification
- `matchOnMessage: true` — SMS handler matches incoming messages against this skill (bypasses orchestrator)
- Cron invocation is always by explicit skill name reference in the job (no matching needed)

### Skill Interface

```typescript
// src/services/skills/types.ts

type SkillActionType = 'execute_with_tools' | 'notify' | 'custom';

interface Skill {
  id: string;
  name: string;                    // slug: lowercase, hyphens
  description: string;
  matchCriteria: string;           // natural language matching rules
  extractFields: string[];
  actionType: SkillActionType;
  actionPrompt: string;
  tools: string[];
  source: 'deployed' | 'runtime';
  enabled: boolean;

  // Scoping — controls which systems use this skill for matching
  matchOnEmail: boolean;
  matchOnMessage: boolean;

  // Runtime skills only
  phoneNumber: string | null;      // null for deployed (all users)
  createdAt: number;
  updatedAt: number;

  // Deployed skills only (optional)
  executor?: SkillExecutor;        // Custom executor for 'custom' actionType
}

type SkillExecutor = (context: SkillExecutionContext) => Promise<SkillExecutionResult>;

interface SkillExecutionContext {
  phoneNumber: string;
  channel: 'sms' | 'whatsapp';
  userConfig: UserConfig | null;
  userFacts: UserFact[];
  input: string;                   // user message, email body, or job prompt
  extracted: Record<string, string | number | null>;
  emailMetadata?: { from: string; subject: string; date: string; messageId: string };
  conversationHistory?: ConversationMessage[];
}

interface SkillExecutionResult {
  success: boolean;
  output: string | null;           // response text to send
  notify: boolean;                 // whether to send SMS notification
  error?: string;
}

interface SkillMatchResult {
  skill: Skill;
  confidence: number;
  extracted: Record<string, string | number | null>;
  summary: string;
}
```

### DB Schema

```sql
-- src/services/skills/sqlite.ts
CREATE TABLE skills (
  id               TEXT PRIMARY KEY,
  phone_number     TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  match_criteria   TEXT NOT NULL,
  extract_fields   TEXT,           -- JSON array
  action_type      TEXT NOT NULL,
  action_prompt    TEXT NOT NULL,
  tools            TEXT,           -- JSON array
  match_on_email   INTEGER DEFAULT 1,
  match_on_message INTEGER DEFAULT 0,
  enabled          INTEGER DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE(phone_number, name)
);
```

**Migration**: On init, check if `email_skills` table exists → copy rows into `skills` (setting `match_on_email=1, match_on_message=0`) → drop `email_skills`.

---

## Key Design Decisions

### 1. Skills bypass the orchestrator

When a user message matches a `matchOnMessage` skill with sufficient confidence (≥ 0.7), the skill executes directly and sends a response. The full orchestrator pipeline (plan → agent selection → execute → replan → compose) is skipped. This is faster and more predictable for well-defined automations.

**Fallthrough**: If no skill matches, or the skill execution fails, the message proceeds to the orchestrator as normal. No degradation.

### 2. `matchOnEmail` / `matchOnMessage` are scoping flags, not triggers

These booleans control which systems use the skill for matching. They are not "trigger" mechanisms:
- `matchOnEmail: true` means the email watcher's classifier will include this skill when classifying incoming emails
- `matchOnMessage: true` means the SMS handler will include this skill when checking if an incoming message matches a skill
- Cron jobs reference skills by name directly — no matching needed

### 3. Runtime skills override deployed skills

If a user creates a runtime skill with the same name as a deployed skill, the runtime version wins. This lets users customize the default behavior (e.g., change the tax-tracker's extract fields or match criteria).

### 4. Deployed skills have no custom executors (for now)

All three initial deployed skills use `execute_with_tools` or `notify`. The `custom` action type with a `SkillExecutor` function is available for future deployed skills that need to invoke agents directly or do complex orchestration.

### 5. Message classifier uses Haiku for speed

The message-to-skill matcher runs in the async phase of SMS processing (so not as latency-sensitive as the sync classifier), but should still be fast. Uses `config.models.classifier` (Haiku) with a simple prompt asking for confidence + extracted fields.

### 6. DB migration is automatic

On first `SkillStore` initialization, if the `email_skills` table exists, rows are copied to `skills` with `match_on_email=1, match_on_message=0`, then `email_skills` is dropped. This is a one-way migration.

---

## Implementation

See [exec-plans/active/skills-system-implementation.md](../exec-plans/active/skills-system-implementation.md) for the step-by-step implementation plan.
