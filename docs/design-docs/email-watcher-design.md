# Design: Email Watcher & Skill Processor

## Overview

A background service that monitors incoming emails via polling, classifies them against a set of **skills**, extracts structured data, and executes actions — writing to spreadsheets or sending notifications. Skills are data, not code: new processing behaviors can be added at runtime via SMS without deploying changes. A set of default skills are seeded per-user when the watcher is first initialized.

---

## Requirements

### R1 — Polling-Based Email Detection

Poll Gmail every 60 seconds using the `history.list` API for incremental sync. Use `historyId` as a cursor to guarantee no missed or duplicate emails. On first run, initialize `historyId` from Gmail profile state (not `messages.list`). Reuse the existing `createIntervalPoller()` abstraction.

### R2 — Skill-Based Classification

Each incoming email is classified against all active skills for the user by a single LLM call. The classifier returns **all matching skills** with confidence scores and extracted data. An email can match multiple skills simultaneously (e.g., a W-2 is both tax and expense). Classification input includes email body plus attachment metadata (filename, MIME type, and size).

### R3 — Default Skills (v1)

Three default skills are seeded per-user when the email watcher is initialized:

- **tax-tracker**: Identify tax-related emails (W-2, 1099, IRS, property tax, deductions). Extract date, vendor, document type, tax year, amount. Append to a per-year "Tax Documents" spreadsheet in Google Sheets.
- **expense-tracker**: Identify expense emails (receipts, invoices, purchase confirmations, subscription charges). Extract vendor, amount, date, category. Append to a per-year "Expenses" spreadsheet.
- **invite-detector**: Identify calendar invitations and event-related emails. Extract event title, date, organizer, location. Send an SMS notification.

### R4 — Auto-Create Spreadsheets

When a skill targets a spreadsheet that doesn't exist, create it in the Hermes Drive folder with appropriate headers. Create a new spreadsheet per year (e.g., "2026 Tax Documents", "2026 Expenses").

### R5 — User-Created Skills at Runtime

Users can create new skills via SMS (e.g., "Start tracking job application emails in a spreadsheet with company, position, and status"). The system generates and stores a skill definition. No code changes or deploys required.

### R6 — Skill Management via SMS

Users can list, enable, disable, update, delete, and test skills through natural language SMS commands.

### R7 — Multi-Match with Notification Dedup

When an email matches multiple skills, all matching actions execute independently (e.g., log to both tax and expense sheets). However, user-facing notifications are merged into a single SMS per email to prevent spam.

### R8 — Two-Phase Execution

- **Phase 1 (Classifier)**: A cheap, fast LLM call (Haiku) classifies the email and extracts structured data. Most emails (~90%) stop here with `action: none`.
- **Phase 2 (Action)**: For matched skills above `EMAIL_WATCHER_CONFIDENCE_THRESHOLD`, execute via `executeWithTools()` with the drive-agent's tools — not the full orchestrator. This keeps cost to 1 LLM call per action, with upgrade path to `orchestrate()` for complex multi-agent skills in the future.

### R9 — Notification Throttling

Max 10 SMS notifications per user per hour. Tracked via an in-memory counter (resets on process restart, which is acceptable for a personal assistant). Excess notifications are silently dropped with a log warning.

### R10 — No Email Body Storage

Email bodies are never persisted. Only structured log output to stdout captures processing decisions.

### R11 — Best-Effort Execution

Skill actions are best-effort. If an action fails, it is logged to stdout and skipped — no retries, no persistent execution tracking. The `historyId` cursor prevents replaying the same email, and the action agent's dedup check on spreadsheet rows handles edge cases.

### R12 — Skill Validation Guardrails

User-created skills are validated before save:
- `action_type` must be one of allowed values.
- `tools` must be from an allowlist for that action type.
- Field lengths are bounded (`name`, `match_criteria`, `action_prompt`).

---

## Architecture

### High-Level Flow

```
┌──────────────────────────────────────────────────────────────┐
│                     Email Watcher Service                     │
│                                                               │
│  ┌──────────┐   ┌──────────────┐   ┌───────────────────────┐│
│  │  Poller   │──▶│ History Sync │──▶│      Classifier       ││
│  │  (60s)    │   │  (per user)  │   │   (Haiku LLM call)    ││
│  └──────────┘   └──────────────┘   │                        ││
│                                     │ Inputs:                ││
│                                     │  • email content       ││
│                                     │  • all active skills   ││
│                                     │  • user facts          ││
│                                     │                        ││
│                                     │ Returns:               ││
│                                     │  • matched skills[]    ││
│                                     │  • extracted data      ││
│                                     │  • confidence scores   ││
│                                     └───────────┬───────────┘│
│                                                   │           │
│                              ┌────────────────────┼────┐      │
│                              ▼                    ▼    ▼      │
│                     execute_with_tools       notify   stdout  │
│                     (drive-agent tools)      (SMS)   (log)    │
│                     ┌──────────────┐                          │
│                     │find/create   │                          │
│                     │sheet → append│                          │
│                     └──────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

### Components

#### 1. Poller

Reuses `createIntervalPoller()` — same pattern as the scheduler and memory processor.

- **Default interval**: 60 seconds (configurable via `EMAIL_WATCHER_INTERVAL_MS`)
- **Overlap prevention**: Built into the poller abstraction (`isProcessing` flag)
- **Per-user processing**: Calls `getEmailWatcherUsers()` to enumerate users with Google credentials + watcher enabled (new query joining `user_config` and `credentials`)
- **Graceful errors**: One user's failure doesn't block others (try-catch per user, same pattern as memory processor)

#### 2. History Sync

Uses Gmail's `history.list` API for efficient incremental change detection.

```
First run:
  1. Call users.getProfile(userId: "me") to get current historyId
  2. Store historyId — no processing (establishes baseline)

Subsequent runs:
  1. Call history.list(startHistoryId, historyTypes: ["messageAdded"])
  2. Follow pagination (`nextPageToken`) until exhausted
  3. Extract new message IDs (INBOX only — skip sent, drafts, spam, trash)
  4. Fetch full content for each new message
  5. Update stored historyId to the latest value returned by Gmail
```

**Why historyId?** It's a cursor, not a time window — no missed emails, no duplicates, cheaper than re-listing. Gmail's recommended sync approach.

**Edge case**: historyId expires after ~30 days of inactivity. Recovery: reset `historyId` from `users.getProfile()` (accept the gap), log a warning, and notify the user via SMS: "Email watching was paused for a while — I may have missed some emails. Want me to scan the last 7 days?" Do not silently backfill.

**Email content normalization**: Each fetched email is prepared for classification via `prepareEmailForClassification()` before being passed to the classifier:
- Prefer the `text/plain` MIME part; fall back to stripping HTML tags from `text/html`
- Decode Content-Transfer-Encoding (quoted-printable, base64)
- Strip base64 inline image data (keep `<img>` alt text if present)
- For no-body emails, use `"[No body — see attachments]"` so the classifier can still match on attachment metadata
- Normalize whitespace (collapse runs of newlines/spaces)
- Truncate to 5000 chars

#### 3. Classifier (Phase 1)

A single Haiku LLM call per email batch. The classifier prompt is **dynamically constructed** from all active skills for the user.

**Prompt structure:**

```
You are classifying incoming emails against the user's active skills.
For each email, determine ALL skills that match (an email can match
multiple skills). Return confidence scores and extract the data fields
each skill requires.

## User Context
{user facts from memory system}

## Active Skills

### tax-tracker
Match when: {skill.match_criteria}
Extract: {skill.extract_fields}

### expense-tracker
Match when: {skill.match_criteria}
Extract: {skill.extract_fields}

### package-watcher
Match when: {skill.match_criteria}
Extract: {skill.extract_fields}

## Emails

### Email 1
From: {from}
Subject: {subject}
Date: {date}
Attachments: [{filename, mime_type, size_bytes}, ...]
Body: {normalized body, truncated to 5000 chars}

## Response Format
Return JSON array, one entry per email:
[{
  "email_index": 1,
  "matches": [
    {
      "skill": "tax-tracker",
      "confidence": 0.92,
      "extracted": { "vendor": "IRS", "type": "W-2", ... },
      "summary": "W-2 form available for 2025 tax year"
    },
    {
      "skill": "expense-tracker",
      "confidence": 0.4,
      ...
    }
  ]
}]

Only include matches with confidence >= {EMAIL_WATCHER_CONFIDENCE_THRESHOLD}.
If no skills match, return: { "email_index": 1, "matches": [] }
```

**Cost control**: Haiku model, max_tokens 2048, batch up to 5 emails per call. Most emails match nothing — cheap to classify, no Phase 2 cost. (1024 is too tight for worst-case: 5 emails × 2 skill matches × ~100 tokens each = ~1000 tokens with no headroom.)

#### 4. Action Execution (Phase 2)

For each matched skill above `EMAIL_WATCHER_CONFIDENCE_THRESHOLD`, execute the skill's action:

| action_type | Execution | LLM Calls |
|-------------|-----------|-----------|
| `execute_with_tools` | `executeWithTools()` with skill's action_prompt + tools | 1 |
| `notify` | `sendSms()` / `sendWhatsApp()` with summary | 0 |

For `execute_with_tools`, the skill's `action_prompt` is combined with extracted data and email metadata into a single task string, then sent to `executeWithTools()` with the skill's tool set. No string interpolation — the action LLM receives the action_prompt verbatim plus structured data as XML-tagged context, and interprets it directly (e.g., determining which year's spreadsheet to target from the extracted dates, handling missing/null fields gracefully).

**Assembled task example (tax-tracker):**
```
Append a row to the "<year> Tax Documents" spreadsheet in the Hermes
folder, where <year> is the tax year from the extracted data (not
necessarily the current year — e.g., a W-2 received in Jan 2026 for
tax year 2025 goes in "2025 Tax Documents"). If the spreadsheet doesn't
exist, create it with headers:
Date | Source | Type | Tax Year | Amount | Description | Email Subject.
Before appending, read the last 10 rows and skip if a duplicate
entry already exists (same source, type, and tax year).
Use "N/A" for any missing fields.

<extracted_data>
{"date": "2026-01-15", "vendor": "IRS", "document_type": "W-2", "tax_year": "2025", "amount": null, "description": "W-2 form available for download"}
</extracted_data>

<email_metadata>
{"subject": "Your W-2 is ready", "from": "no-reply@irs.gov", "date": "2026-01-15T10:30:00Z"}
</email_metadata>
```

For `notify` actions, the classifier's `summary` field is used directly — no action LLM call needed. The `action_prompt` on notify skills serves as instructions to the classifier for how to write the summary (included in the classifier prompt alongside `match_criteria`), not as input to an action agent.

**Deduplication**: Action prompts for spreadsheet skills instruct the agent to check recent rows before appending. This handles thread-level duplicates (e.g., order confirmation followed by shipping update) at the action layer rather than the watcher layer, giving the LLM domain context to make smarter dedup decisions.

**Multi-match execution order:**
1. All `execute_with_tools` actions run (sequentially, to avoid API race conditions)
2. All notification summaries are collected
3. A single merged SMS is sent per email

**Merged notification example:**
```
New email from IRS — "Your W-2 is ready":
 • Logged to 2026 Tax Documents (W-2, tax year 2025)
 • Logged to 2026 Expenses (amount: $0 — document only)
```

**Future upgrade path**: Any skill can set `action_type: "orchestrate"` to use the full orchestrator for complex multi-agent workflows (e.g., vision + sheets + calendar). The action router checks the type and dispatches accordingly.

---

## Skill System

### Skill Definition

```typescript
interface EmailSkill {
  id: string;
  phoneNumber: string;             // Always a real phone number
  name: string;                    // Unique per user: "tax-tracker"
  description: string;             // Human-readable purpose
  matchCriteria: string;           // Natural language: when to trigger
  extractFields: string[];         // ["vendor", "amount", "date"]
  actionType: 'execute_with_tools' | 'notify';
  actionPrompt: string;            // Natural language instructions for the action agent
  tools: string[];                 // Tool names for execute_with_tools
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
```

### Default Skills (seeded per-user on watcher init)

**tax-tracker:**
```yaml
match_criteria: >
  Tax-related emails: W-2 forms, 1099 forms, IRS correspondence,
  property tax statements, tax refund notices, tax preparation
  service communications, HSA/FSA tax documents, charitable
  donation receipts for tax purposes, mortgage interest statements
extract_fields: [date, vendor, document_type, tax_year, amount, description]
action_type: execute_with_tools
action_prompt: >
  Append a row to the "<year> Tax Documents" spreadsheet in the
  Hermes folder, where <year> is the tax year from the extracted data
  (not necessarily the current year — e.g., a W-2 received in Jan 2026
  for tax year 2025 goes in "2025 Tax Documents").
  If the spreadsheet doesn't exist, create it with headers:
  Date | Source | Type | Tax Year | Amount | Description | Email Subject.
  Before appending, read the last 10 rows and skip if a duplicate
  entry already exists (same source, type, and tax year).
  Use "N/A" for any missing fields.
tools: [find_spreadsheet, create_spreadsheet, read_spreadsheet, append_to_spreadsheet]
```

**expense-tracker:**
```yaml
match_criteria: >
  Expense-related emails: purchase receipts, invoices, order
  confirmations, subscription charges, payment confirmations,
  billing statements, refund notices
extract_fields: [vendor, amount, date, category, description]
action_type: execute_with_tools
action_prompt: >
  Append a row to the "<year> Expenses" spreadsheet in the Hermes
  folder, where <year> is determined from the email/transaction date.
  If the spreadsheet doesn't exist, create it with headers:
  Date | Vendor | Amount | Category | Description | Email Subject.
  Before appending, read the last 10 rows and skip if a duplicate
  entry already exists (same vendor, amount, and date).
  Use "N/A" for any missing fields.
tools: [find_spreadsheet, create_spreadsheet, read_spreadsheet, append_to_spreadsheet]
```

**invite-detector:**
```yaml
match_criteria: >
  Calendar invitations, event invites, meeting requests, RSVP
  requests, conference registrations, webinar invitations.
  Not general "save the date" marketing.
extract_fields: [event_title, event_date, organizer, location]
action_type: notify
action_prompt: >
  Summarize the invitation: include event title, organizer,
  date/time, and location. Keep it to 1-2 sentences.
```

### User-Created Skills

Users create skills via SMS. The message flows through the normal orchestrator to a new `create_email_skill` tool.

**Example interaction:**
```
User: "Start tracking job application emails in a spreadsheet
       with company, position, date, and status"

Hermes: "Done — I created an email skill called 'job-applications'.
         I'll watch for application confirmations, interview invites,
         status updates, and offer/rejection emails, and log them to
         a '2026 Job Applications' spreadsheet. You can manage this
         with 'show my email skills' or 'disable job-applications'."
```

**What the tool generates:**
```typescript
{
  name: "job-applications",
  description: "Tracks job application correspondence",
  matchCriteria: "Job application confirmations, interview invitations, application status updates, rejection notices, offer letters from companies or platforms like LinkedIn, Indeed, Greenhouse",
  extractFields: ["company", "position", "date", "status"],
  actionType: "execute_with_tools",
  actionPrompt: "Append a row to the '<year> Job Applications' spreadsheet in Hermes folder, where <year> is determined from the email date. If it doesn't exist, create it with headers: Date | Company | Position | Status | Notes. Before appending, read the last 10 rows and skip if a duplicate entry already exists (same company and position). Use 'N/A' for any missing fields.",
  tools: ["find_spreadsheet", "create_spreadsheet", "read_spreadsheet", "append_to_spreadsheet"]
}
```

The LLM generating the skill definition knows what tools exist and writes valid action prompts. Before saving, the system validates action type, tool allowlist, and length limits. On the next poll cycle, the classifier sees the new skill and starts matching.

### Skill Management via SMS

| Command | Action |
|---------|--------|
| "Show my email skills" | List all skills with status |
| "Disable the package tracker" | Set `enabled = false` |
| "Update the job tracker to also extract salary" | Modify skill fields |
| "Delete the package tracker skill" | Remove from DB |
| "Pause email watching" | Disable watcher for user |
| "Test the job tracker on my last 5 emails" | Dry-run matches + extracted fields without executing actions |

Implemented as new tools on the email-agent: `list_email_skills`, `create_email_skill`, `update_email_skill`, `delete_email_skill`, `toggle_email_watcher`, `test_email_skill`.

---

## Data Model

Uses the existing `credentials.db` — watcher state stored in `user_config`, skills in one new table.

### Watcher State (new columns on `user_config`)

Two new columns added to the existing `user_config` table:

```sql
ALTER TABLE user_config ADD COLUMN email_watcher_history_id TEXT;
ALTER TABLE user_config ADD COLUMN email_watcher_enabled INTEGER DEFAULT 0;
```

| Column | Type | Purpose |
|--------|------|---------|
| `email_watcher_history_id` | `TEXT` | Gmail historyId incremental sync cursor |
| `email_watcher_enabled` | `INTEGER` | Watcher on/off toggle (0/1) |

The `UserConfigStore` interface gains two new methods:

```typescript
getEmailWatcherUsers(): Promise<UserConfig[]>;  // All users with watcher enabled + Google credentials
updateEmailWatcherState(phoneNumber: string, historyId: string): Promise<void>;
```

`getEmailWatcherUsers()` joins `user_config` with `credentials` to return only users who have both `email_watcher_enabled = 1` and a valid Google credential row. This is the enumeration query used by the poller.

### `email_skills`

Skill definitions — default and user-created, all scoped to a phone number. The only new table.

```sql
CREATE TABLE IF NOT EXISTS email_skills (
  id              TEXT PRIMARY KEY,
  phone_number    TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  match_criteria  TEXT NOT NULL,
  extract_fields  TEXT,                -- JSON: ["vendor","amount","date"]
  action_type     TEXT NOT NULL,       -- 'execute_with_tools' | 'notify'
  action_prompt   TEXT NOT NULL,
  tools           TEXT,                -- JSON: ["find_spreadsheet","append_to_spreadsheet"]
  enabled         INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(phone_number, name)
);
```

### Observability

All processing decisions are logged to **stdout as structured JSON** — no database tables for audit, execution tracking, or digest queues. This keeps the data model minimal while still providing visibility via application logs.

---

## Processing Pipeline

```
pollEmailsForAllUsers()
│
├── For each user with credentials + watcher enabled:
│   │
│   ├── syncNewEmails(phoneNumber)
│   │   ├── Load historyId from user_config
│   │   ├── Call Gmail history.list(startHistoryId, historyTypes: ["messageAdded"])
│   │   ├── Follow nextPageToken until all history pages are read
│   │   ├── Filter to INBOX messages only
│   │   ├── Fetch full content via messages.get (batch)
│   │   ├── Normalize each email body via prepareEmailForClassification()
│   │   ├── Update historyId in user_config
│   │   └── Return IncomingEmail[]
│   │
│   ├── Skip if no new emails
│   │
│   ├── classifyEmails(phoneNumber, emails)                    ── Phase 1
│   │   ├── Load active skills for user
│   │   ├── Load user facts (memory system)
│   │   ├── Build classifier prompt (skills injected dynamically)
│   │   ├── Include attachment metadata (filename, MIME type, size)
│   │   ├── Call Haiku LLM (batch up to 5 emails per call)
│   │   ├── Parse response → ClassificationResult[]
│   │   ├── Filter matches by EMAIL_WATCHER_CONFIDENCE_THRESHOLD
│   │   └── Return matched skills + extracted data per email
│   │
│   ├── executeSkillActions(phoneNumber, classifications)      ── Phase 2
│   │   │
│   │   ├── For each email with matches:
│   │   │   │
│   │   │   ├── For each matched skill:
│   │   │   │   ├── If execute_with_tools:
│   │   │   │   │   ├── Build task from action_prompt + extracted data as JSON context
│   │   │   │   │   ├── Call executeWithTools(prompt, task, skill.tools, context)
│   │   │   │   │   └── Log result to stdout
│   │   │   │   └── If notify:
│   │   │   │       └── Collect summary for merged notification
│   │   │   │
│   │   │   ├── Merge all notify summaries for this email
│   │   │   └── Send single SMS (with in-memory throttle check)
│   │   │
│   │   └── Log emails with no matches
│   │
│   └── Log per-user cycle summary
│
└── Log overall cycle summary
```

---

## New Files

```
src/services/email-watcher/
  ├── index.ts              # startEmailWatcher() / stopEmailWatcher()
  ├── sync.ts               # Gmail history sync (incremental fetch)
  ├── classifier.ts         # LLM classification against active skills
  ├── actions.ts            # Action router (execute, notify)
  ├── skills.ts             # Load/seed per-user default skills, manage definitions
  ├── prompt.ts             # Classifier prompt construction
  ├── sqlite.ts             # DB operations (email_skills table)
  └── types.ts              # Interfaces

src/tools/email-skills.ts   # Tools: create/list/update/delete/toggle skills

src/admin/views/email-skills.html  # Skill management UI page
src/admin/email-skills.ts          # API handlers for skill CRUD + log + status
```

---

## Configuration

```bash
# Enable/disable the email watcher (default: true)
EMAIL_WATCHER_ENABLED=true

# Polling interval in milliseconds (default: 60000)
EMAIL_WATCHER_INTERVAL_MS=60000

# Classifier model (default: fast/cheap)
EMAIL_WATCHER_MODEL_ID=claude-haiku-4-5-20251001

# Max emails to process per poll cycle (default: 20)
EMAIL_WATCHER_BATCH_SIZE=20

# Max SMS notifications per user per hour (default: 10)
EMAIL_WATCHER_MAX_NOTIFICATIONS_PER_HOUR=10

# Confidence threshold for skill matching + action execution (email watcher only)
EMAIL_WATCHER_CONFIDENCE_THRESHOLD=0.6
```

---

## Integration Points

### Server Startup (`src/index.ts`)

```typescript
import { startEmailWatcher } from './services/email-watcher/index.js';

// After existing scheduler and memory processor startup:
startEmailWatcher();
```

### OAuth Callback (`src/routes/auth.ts`)

When a user completes Google OAuth, initialize watcher state and seed default skills:

```typescript
await initEmailWatcherState(phoneNumber); // Sets user_config keys + seeds default skills for this user
```

### Email Agent — Skill Management Tools and Prompt

New tools added to the email-agent's tool set:

- `create_email_skill` — Generate a skill definition from natural language
- `list_email_skills` — Show all active/inactive skills for user
- `update_email_skill` — Modify an existing skill
- `delete_email_skill` — Remove a skill
- `toggle_email_watcher` — Enable/disable the watcher
- `test_email_skill` — Dry-run a skill on recent emails without executing actions

The email-agent prompt (`src/agents/email/prompt.ts`) gets a new section governing skill creation behavior. This is the prompt that controls when the agent asks clarifying questions vs. proceeds directly:

```
## Email Skill Management

When the user asks to create a new email tracking skill:

1. Identify what's clear vs. ambiguous from their request.
2. If ANY of these are missing or unclear, ask before creating:
   - What types of emails to match (specific enough to avoid false positives)
   - What data to extract from matching emails
   - What action to take (log to spreadsheet, send notification, or both)
3. Keep clarification to 1-3 focused questions in a single message. Don't over-ask.
4. Once you have enough context, call create_email_skill.
5. After creating, confirm what was created and tell the user how to manage it
   ("you can say 'show my email skills' or 'disable <name>'").

Do NOT ask clarifying questions when the user's intent is obvious:
  "Track my expenses in a spreadsheet" → clear enough, create it directly.
  "Track my emails" → too vague, ask what kind and what to do with them.
  "Notify me about emails from John" → clear, create a notify skill.

When updating a skill, show the user what will change and confirm before saving.
When deleting a skill, confirm the action ("Are you sure you want to delete
the 'job-applications' skill? This can't be undone.").
```

Multi-turn skill creation works through existing conversation history — no separate agent needed. When the agent asks questions in Turn 1, the user's reply in Turn 2 is routed back to the email-agent because the planner sees the skill creation context in the conversation window.

**Example flow:**
```
Turn 1:
  User: "I want to track some emails"
  Planner → email-agent (email-related request)
  Agent: "Sure! What kind of emails would you like to track, and what
          should I do when I find them? For example:
          - Log to a spreadsheet (what columns?)
          - Send you a notification
          - Both"

Turn 2:
  User: "Track freelance invoices. Log client, amount, and due date.
         Notify me too."
  Planner sees history → email-agent continuation
  Agent calls create_email_skill → confirms:
  "Created 'freelance-invoices' skill. I'll watch for freelance invoices
   and log them to a '2026 Freelance Invoices' sheet (Client | Amount |
   Due Date columns) + send you a notification. Manage with
   'show my email skills'."
```

### Memory System

Email processing patterns feed into the memory system naturally. If the user says "stop notifying me about LinkedIn emails", the memory processor captures that as a fact, and the user can also explicitly disable or adjust the relevant skill.

---

## Admin UI — Skill Manager

A web-based management interface at `/admin/email-skills`, following the same pattern as the existing memory admin UI (`/admin/memory`): a static HTML file served by Express with client-side AJAX to API endpoints.

### API Endpoints

```
GET    /admin/email-skills                   → Serve static HTML page
GET    /admin/api/email-skills               → List all skills
POST   /admin/api/email-skills               → Create a skill
PUT    /admin/api/email-skills/:id           → Update a skill
DELETE /admin/api/email-skills/:id           → Delete a skill
PATCH  /admin/api/email-skills/:id/toggle    → Enable/disable a skill

GET    /admin/api/email-watcher/status       → Watcher status per user
POST   /admin/api/email-watcher/toggle       → Enable/disable watcher for user
```

Routes registered in the existing `src/admin/index.ts` router alongside memory routes.

### Page Layout

```
┌───────────────────────────────────────────────────────┐
│  Email Skills Manager                          ☀️/🌙  │
├───────────────────────────────────────────────────────┤
│                                                        │
│  Watcher: ● Running (last sync: 30s ago)   [Pause]    │
│  Skills: 5 active, 1 disabled                          │
│                                                        │
│  ─── Skills ────────────────────────────────────────── │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ tax-tracker                              [ON/off] │ │
│  │ Match: W-2, 1099, IRS correspondence...           │ │
│  │ Action: execute_with_tools → spreadsheet          │ │
│  │                                     [Edit] [Delete]│ │
│  └──────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ expense-tracker                          [ON/off] │ │
│  │ Match: receipts, invoices, purchases...           │ │
│  │ Action: execute_with_tools → spreadsheet          │ │
│  └──────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ job-applications                         [ON/off] │ │
│  │ Match: application confirmations, interviews...   │ │
│  │ Action: execute_with_tools → spreadsheet          │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
└───────────────────────────────────────────────────────┘
```

### Features

- **Skill cards**: Each skill displayed with match criteria, action type. Toggle enable/disable inline.
- **Edit modal**: Click "Edit" to modify match_criteria, extract_fields, action_type, and action_prompt in a form.
- **Watcher status**: Shows running/paused state, last sync time, and a pause/resume button.
- **Dark/light mode**: Theme toggle with localStorage persistence (same pattern as memory UI).

### Implementation Notes

- Static HTML file at `src/admin/views/email-skills.html` with embedded CSS/JS (no build step, same as memory.html).
- Client-side AJAX calls to `/admin/api/email-skills` endpoints.
- XSS protection: all user-generated content (skill names, match criteria) escaped via `escapeHtml()` before rendering.

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| Gmail 429 (rate limit) | Skip user this cycle, retry next |
| Invalid historyId (404) | Reset: re-establish baseline from profile, notify user |
| Auth expired / revoked | Skip user, log `AuthRequiredError` |
| Classifier parse failure | Retry once; if still fails, skip all emails this cycle |
| Action execution failure | Log error to stdout, skip — best effort |
| SMS send failure | Log error to stdout |
| Spreadsheet create failure | Agent handles via tool loop retry (up to 5 tool iterations) |
| No credentials for user | Skip silently |

---

## Security and Privacy

- **No email body storage**: Bodies are passed to the LLM but never persisted. Only structured log output to stdout.
- **Per-user isolation**: Skills and watcher state are scoped by phone number.
- **Credential reuse**: Uses existing encrypted credential store. No new OAuth flows.
- **Read-only Gmail**: Scope remains `gmail.readonly`. No email mutation.
- **Skill validation**: User-created skills are generated by the LLM and validated server-side (action type, tools allowlist, length limits).

---

## Gmail API Quota Impact

| Call | Units | Per day (60s poll) |
|------|-------|--------------------|
| `history.list` | 2 | 2,880 |
| `messages.get` (avg 30 emails/day) | 5 each | 150 |
| **Total per user per day** | | **~3,000** |
| **Project daily limit** | | 1,000,000,000 |

Negligible quota usage. Even at 10s polling intervals the quota impact is trivial.

---

## Appendix A: Future — Gmail Push Notifications

Polling has ~60s latency. For <5s latency, Gmail supports push via Google Cloud Pub/Sub:

1. Create GCP Pub/Sub topic + push subscription → `POST /webhook/gmail`
2. Call `gmail.users.watch()` per user (expires every 7 days, must renew)
3. On notification → run the same classification pipeline

**Why defer**: Pub/Sub doesn't replace `history.list` — it only triggers it sooner. Same pipeline, more infrastructure. Polling is sufficient for a personal assistant. The architecture is designed so swapping the trigger from poller to webhook is a single-file change in `index.ts`.

## Appendix B: Potential Future Skills

These could be seeded as additional default skills or created by users at runtime:

- **Bill due dates**: Extract amount + due date → create calendar reminder. May need `action_type: orchestrate` for multi-agent (calendar + drive).
- **Package tracking**: Shipping confirmations → notify with carrier + tracking + ETA.
- **Security alerts**: Login notifications, password changes, 2FA → immediate high-priority notify.
- **Travel confirmations**: Flights, hotels, car rentals → calendar events + itinerary sheet.
- **Subscription renewals**: "Your plan renews on..." → log to subscriptions tracker.

## Appendix C: Open Questions

1. ~~**Thread awareness**~~: Resolved — deduplication is handled at the action layer. Action prompts for spreadsheet skills instruct the agent to check recent rows before appending. This avoids watcher-level thread tracking and gives the action LLM domain context for smarter dedup decisions.
2. **Scope expansion**: Auto-archive/label would need `gmail.modify` scope. Add to OAuth scope list now or wait?
