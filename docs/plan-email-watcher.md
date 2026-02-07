# Implementation Plan: Email Watcher & Skill Processor

Reference: [design-email-watcher.md](design-email-watcher.md)

This plan is organized into **phases** with **independent workstreams** within each phase. Workstreams with no dependencies between them can be executed in parallel by different agents. Test and UI workstreams are separated from core logic.

---

## Dependency Graph

```
Phase 1: Foundation
  ├── 1A  Types & interfaces
  ├── 1B  Config (env vars)                          ← 1A
  ├── 1C  SQLite: email_skills table + CRUD          ← 1A
  └── 1D  user_config: new columns + methods         ← 1A
          (1B, 1C, 1D can run in parallel after 1A)

Phase 2: Core Pipeline
  ├── 2A  Gmail history sync + normalization         ← 1C, 1D
  ├── 2B  Classifier (prompt + LLM + parsing)        ← 1A, 1C
  ├── 2C  Action router + notification throttle      ← 1A, 1B
  └── 2D  Skills management (seed, validate, load)   ← 1C
          (2A, 2B, 2C, 2D can run in parallel)

Phase 3: Integration & SMS Tools  (parallel workstreams)
  ├── 3A  Poller + server wiring                     ← 2A, 2B, 2C, 2D
  ├── 3B  SMS skill tools + email-agent updates      ← 1C, 2D
  └── 3C  OAuth callback hook                        ← 1D, 2D
          (3B and 3C can start as soon as their deps are met,
           without waiting for all of Phase 2)

Phase 4: Admin UI  (independent workstream)
  ├── 4A  API endpoints                              ← 1C, 1D
  └── 4B  HTML page                                  ← 4A

Phase 5: Tests  (independent workstream — can start per-module)
  ├── 5A  Unit tests: data layer (sqlite, config)    ← Phase 1
  ├── 5B  Unit tests: pipeline (sync, classifier,    ← Phase 2
  │        actions, skills)
  ├── 5C  Unit tests: SMS tools                      ← 3B
  ├── 5D  Unit tests: admin API                      ← 4A
  └── 5E  Integration tests                          ← Phase 3

Phase 6: Docs & Cleanup
  └── 6A  ARCHITECTURE.md update                     ← all
```

---

## Phase 1: Foundation

All subsequent work depends on this phase. Start with **1A** (types), then **1B/1C/1D** in parallel.

### 1A — Types & Interfaces

**File**: `src/services/email-watcher/types.ts`

Define all shared types. Every other workstream imports from here.

```typescript
// Core email representation after fetch + normalization
interface IncomingEmail {
  messageId: string;
  from: string;
  subject: string;
  date: string;                  // ISO 8601
  body: string;                  // Normalized, truncated to 5000 chars
  attachments: EmailAttachment[];
}

interface EmailAttachment {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

// Skill definition (matches DB schema)
interface EmailSkill {
  id: string;
  phoneNumber: string;
  name: string;
  description: string;
  matchCriteria: string;
  extractFields: string[];
  actionType: 'execute_with_tools' | 'notify';
  actionPrompt: string;
  tools: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// Classifier output
interface ClassificationResult {
  emailIndex: number;
  email: IncomingEmail;          // Carry the email through for action phase
  matches: SkillMatch[];
}

interface SkillMatch {
  skill: string;                 // Skill name
  confidence: number;
  extracted: Record<string, string | number | null>;
  summary: string;
}

// Skill validation
interface SkillValidationError {
  field: string;
  message: string;
}

// Notification throttle state
interface ThrottleState {
  count: number;
  windowStart: number;           // Unix ms
}
```

**Acceptance criteria**:
- All types exported and importable
- No runtime code in this file — types only
- Builds cleanly (`npm run build`)

---

### 1B — Config (env vars)

**File**: `src/config.ts` — add `emailWatcher` section

Add the new config block to the existing config object (after the `memoryProcessor` section, ~line 105):

```typescript
emailWatcher: {
  enabled: process.env.EMAIL_WATCHER_ENABLED !== 'false',
  intervalMs: parseInt(process.env.EMAIL_WATCHER_INTERVAL_MS || '60000', 10),
  modelId: process.env.EMAIL_WATCHER_MODEL_ID || 'claude-haiku-4-5-20251001',
  batchSize: parseInt(process.env.EMAIL_WATCHER_BATCH_SIZE || '20', 10),
  maxNotificationsPerHour: parseInt(process.env.EMAIL_WATCHER_MAX_NOTIFICATIONS_PER_HOUR || '10', 10),
  confidenceThreshold: parseFloat(process.env.EMAIL_WATCHER_CONFIDENCE_THRESHOLD || '0.6'),
},
```

Add validation in `validateConfig()`:
- `intervalMs` must be >= 10000 (prevent accidental abuse)
- `batchSize` must be 1-100
- `confidenceThreshold` must be 0.0-1.0

**Acceptance criteria**:
- Config accessible as `config.emailWatcher.*`
- Bad values caught at startup by `validateConfig()`
- No new required env vars (all have defaults)

---

### 1C — SQLite: `email_skills` Table + CRUD

**File**: `src/services/email-watcher/sqlite.ts`

Follow the pattern in `src/services/user-config/sqlite.ts`. Use the **same `credentials.db`** database instance (passed in constructor).

**Schema** (created in constructor):

```sql
CREATE TABLE IF NOT EXISTS email_skills (
  id              TEXT PRIMARY KEY,
  phone_number    TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  match_criteria  TEXT NOT NULL,
  extract_fields  TEXT,
  action_type     TEXT NOT NULL,
  action_prompt   TEXT NOT NULL,
  tools           TEXT,
  enabled         INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(phone_number, name)
);
```

**Methods to implement**:

| Method | Signature | Notes |
|--------|-----------|-------|
| `getSkillsForUser` | `(phoneNumber: string, enabledOnly?: boolean) => EmailSkill[]` | Default `enabledOnly = false` for admin, `true` for classifier |
| `getSkillById` | `(id: string) => EmailSkill \| null` | |
| `getSkillByName` | `(phoneNumber: string, name: string) => EmailSkill \| null` | For SMS commands like "disable tax-tracker" |
| `createSkill` | `(skill: Omit<EmailSkill, 'id' \| 'createdAt' \| 'updatedAt'>) => EmailSkill` | Generate UUID, set timestamps |
| `updateSkill` | `(id: string, updates: Partial<EmailSkill>) => EmailSkill` | Set `updatedAt` |
| `deleteSkill` | `(id: string) => void` | |
| `toggleSkill` | `(id: string, enabled: boolean) => void` | |
| `deleteAllSkillsForUser` | `(phoneNumber: string) => void` | For user data cleanup |

**Implementation notes**:
- JSON serialize `extractFields` and `tools` arrays on write, parse on read
- Use `crypto.randomUUID()` for IDs
- Constructor takes `Database` instance (same as other sqlite stores)
- Export a singleton getter: `getEmailSkillStore(db?: Database): EmailSkillStore`

**Acceptance criteria**:
- All CRUD operations work
- JSON fields round-trip correctly
- UNIQUE constraint on `(phone_number, name)` enforced
- Builds cleanly

---

### 1D — `user_config`: New Columns + Methods

**Files**: `src/services/user-config/sqlite.ts`, `src/services/user-config/types.ts`

**Schema change** — add columns in constructor (after CREATE TABLE, use ALTER TABLE with try-catch for idempotency):

```typescript
// Idempotent column additions (SQLite doesn't support IF NOT EXISTS for ALTER)
try {
  this.db.exec('ALTER TABLE user_config ADD COLUMN email_watcher_history_id TEXT');
} catch { /* column already exists */ }
try {
  this.db.exec('ALTER TABLE user_config ADD COLUMN email_watcher_enabled INTEGER DEFAULT 0');
} catch { /* column already exists */ }
```

**Update `UserConfig` type** to include new optional fields:

```typescript
interface UserConfig {
  phoneNumber: string;
  name?: string;
  timezone?: string;
  emailWatcherHistoryId?: string;
  emailWatcherEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
}
```

**Update existing methods**:
- `get()`: Add new columns to SELECT, map `email_watcher_enabled` (0/1) to boolean
- `set()`: Handle new fields in the dynamic UPDATE builder and INSERT

**Add new methods**:

```typescript
// Returns all users with watcher enabled AND a Google credential row
async getEmailWatcherUsers(): Promise<UserConfig[]> {
  // JOIN user_config uc ON uc.email_watcher_enabled = 1
  //   INNER JOIN credentials c ON c.phone_number = uc.phone_number AND c.provider = 'google'
}

// Update historyId without touching other fields
async updateEmailWatcherState(phoneNumber: string, historyId: string): Promise<void> {
  // UPDATE user_config SET email_watcher_history_id = ?, updated_at = ? WHERE phone_number = ?
}
```

**Acceptance criteria**:
- Columns added idempotently (safe to run multiple times)
- Existing `get()`/`set()` still work for callers that don't use new fields
- `getEmailWatcherUsers()` returns only users with credentials + watcher enabled
- `updateEmailWatcherState()` is a fast, targeted update

---

## Phase 2: Core Pipeline

All workstreams in this phase can run in parallel. Each produces a self-contained module with a clear public API.

### 2A — Gmail History Sync + Email Normalization

**File**: `src/services/email-watcher/sync.ts`

Two public functions:

#### `syncNewEmails(phoneNumber: string): Promise<IncomingEmail[]>`

1. Get Google OAuth client for user (reuse `getAuthenticatedClient` from existing email tools)
2. Load `emailWatcherHistoryId` from `user_config`
3. **First run** (no historyId):
   - Call `gmail.users.getProfile({ userId: 'me' })` to get current `historyId`
   - Store it via `updateEmailWatcherState()`
   - Return `[]` (no processing — baseline established)
4. **Subsequent runs**:
   - Call `gmail.users.history.list({ userId: 'me', startHistoryId, historyTypes: ['messageAdded'] })`
   - Follow `nextPageToken` pagination
   - Filter to messages with `INBOX` label (skip sent, drafts, spam, trash)
   - Deduplicate message IDs (history can report the same message in multiple entries)
   - Fetch content via `gmail.users.messages.get()` for each (limit to `config.emailWatcher.batchSize`)
   - Call `prepareEmailForClassification()` for each
   - Update `historyId` via `updateEmailWatcherState()`
   - Return `IncomingEmail[]`
5. **Error: historyId invalid (HTTP 404)**:
   - Reset historyId from `users.getProfile()`
   - Log warning
   - Return `[]` (caller handles user notification)

#### `prepareEmailForClassification(message: gmail_v1.Schema$Message): IncomingEmail`

Pure function, no I/O. Extracts and normalizes:

1. Parse headers: `From`, `Subject`, `Date`
2. Walk MIME parts:
   - Prefer `text/plain`; fall back to `text/html` with tags stripped
   - Decode `Content-Transfer-Encoding` (base64, quoted-printable)
   - Strip base64 inline image data, keep `alt` text
3. For no-body emails: `"[No body — see attachments]"`
4. Collect attachment metadata: `{ filename, mimeType, sizeBytes }` from non-inline parts
5. Normalize whitespace (collapse runs of `\n` and spaces)
6. Truncate body to 5000 chars

**Reference**: Existing email tool fetch pattern in `src/tools/email.ts` — reuse the Gmail client setup but not the tool handler itself.

**Acceptance criteria**:
- First run establishes baseline without processing
- Pagination exhausted (all history pages read)
- INBOX-only filtering
- Invalid historyId recovery without crash
- `prepareEmailForClassification` handles plain text, HTML, no-body, and attachment-only emails
- Body truncated to 5000 chars

---

### 2B — Classifier (Prompt + LLM Call + Parsing)

**Files**: `src/services/email-watcher/prompt.ts`, `src/services/email-watcher/classifier.ts`

#### `prompt.ts` — `buildClassifierPrompt(skills: EmailSkill[], userFacts: string[]): string`

Pure function. Constructs the classifier system prompt dynamically from active skills. Follow the prompt structure in the design doc (Section 3: Classifier). Include:
- User facts section (from memory system)
- Active skills section (one block per skill with `match_criteria`, `extract_fields`, and `action_prompt` for notify skills)
- Response format specification with JSON schema
- Confidence threshold instruction

#### `classifier.ts` — `classifyEmails(phoneNumber: string, emails: IncomingEmail[]): Promise<ClassificationResult[]>`

1. Load active skills for user via `getSkillsForUser(phoneNumber, true)`
2. If no active skills, return empty array (skip LLM call)
3. Load user facts from memory system (reuse `getRelevantFacts()`)
4. Build prompt via `buildClassifierPrompt()`
5. Batch emails: up to 5 per LLM call
6. For each batch:
   - Build user message with email content (from, subject, date, attachments, body)
   - Call Anthropic with Haiku model (`config.emailWatcher.modelId`), `max_tokens: 2048`
   - Parse JSON response
   - If parse fails: retry once with a repair prompt (same pattern as planner repair in `src/orchestrator/planner.ts`)
   - Filter matches below `config.emailWatcher.confidenceThreshold`
7. Attach `IncomingEmail` reference to each `ClassificationResult` for downstream use
8. Return `ClassificationResult[]`

**Acceptance criteria**:
- No LLM call when no active skills exist
- Batching: 5 emails per call, handles remainder batch
- JSON parse failure → one retry → skip batch on second failure
- Confidence filtering applied
- Structured log output for each classification

---

### 2C — Action Router + Notification Throttle

**File**: `src/services/email-watcher/actions.ts`

#### `executeSkillActions(phoneNumber: string, classifications: ClassificationResult[]): Promise<void>`

For each email with matches:

1. **`execute_with_tools` actions** — run sequentially:
   - Build task string: `skill.actionPrompt` + `<extracted_data>` + `<email_metadata>` (XML-tagged JSON, as shown in design doc)
   - Build system prompt: short context about being an email processing agent
   - Call `executeWithTools(systemPrompt, task, skill.tools, context)`
   - Log result (success/failure) to stdout
   - Collect summary for notification if action succeeded

2. **`notify` actions** — collect summaries:
   - Use `match.summary` from classifier output

3. **Merge notifications** per email:
   - If any notifications pending, format merged message (design doc example format)
   - Check throttle before sending

4. Send single SMS per email via `sendSms()` / `sendWhatsApp()` (determine channel from user config or default to SMS)

#### Notification throttle (in-memory)

```typescript
// Module-level Map — resets on process restart (acceptable per design)
const throttleMap = new Map<string, ThrottleState>();

function canSendNotification(phoneNumber: string): boolean {
  const state = throttleMap.get(phoneNumber);
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour

  if (!state || now - state.windowStart > windowMs) {
    throttleMap.set(phoneNumber, { count: 1, windowStart: now });
    return true;
  }

  if (state.count >= config.emailWatcher.maxNotificationsPerHour) {
    return false; // Log warning at call site
  }

  state.count++;
  return true;
}
```

**Acceptance criteria**:
- `execute_with_tools` actions run sequentially
- Task string assembled correctly with XML-tagged context
- Notifications merged per email (single SMS even for multi-match)
- Throttle enforced: max N per user per hour
- Action failure logged but doesn't block other actions or notifications
- Channel detection (SMS vs WhatsApp)

---

### 2D — Skills Management (Seed, Validate, Load)

**File**: `src/services/email-watcher/skills.ts`

#### `seedDefaultSkills(phoneNumber: string): Promise<void>`

Idempotent — checks if skills already exist before creating. Seeds the three default skills from the design doc (tax-tracker, expense-tracker, invite-detector) with exact `matchCriteria`, `extractFields`, `actionPrompt`, and `tools` values.

#### `validateSkillDefinition(skill: Partial<EmailSkill>): SkillValidationError[]`

Validates before save:
- `name`: required, 1-50 chars, slug format (`[a-z0-9-]`)
- `matchCriteria`: required, 10-1000 chars
- `actionType`: must be `'execute_with_tools'` or `'notify'`
- `actionPrompt`: required, 10-2000 chars
- `tools`: if `actionType === 'execute_with_tools'`, must be non-empty and all names must be in allowlist
- `extractFields`: if provided, each field name must be 1-50 chars, max 20 fields

#### Tool allowlist

```typescript
const ALLOWED_SKILL_TOOLS = [
  'find_spreadsheet',
  'create_spreadsheet',
  'read_spreadsheet',
  'write_spreadsheet',
  'append_to_spreadsheet',
  'find_document',
  'create_document',
  'append_to_document',
];
```

Only drive/sheets/docs tools — no calendar, no email send, no vision (for now).

#### `initEmailWatcherState(phoneNumber: string): Promise<void>`

Called from OAuth callback. Sets `email_watcher_enabled = true` in user_config and calls `seedDefaultSkills()`.

**Acceptance criteria**:
- Default skills match design doc exactly
- Seeding is idempotent (safe to call multiple times)
- Validation catches all edge cases
- Tool allowlist enforced
- `initEmailWatcherState` is safe to call from OAuth callback

---

## Phase 3: Integration & SMS Tools

### 3A — Poller + Server Wiring

**File**: `src/services/email-watcher/index.ts`

Exports `startEmailWatcher()` and `stopEmailWatcher()`.

#### `startEmailWatcher(): Poller`

Uses `createIntervalPoller()` with a callback that:

1. Calls `getEmailWatcherUsers()` to enumerate users
2. For each user (try-catch per user):
   a. `syncNewEmails(phoneNumber)` → `IncomingEmail[]`
   b. Skip if empty
   c. `classifyEmails(phoneNumber, emails)` → `ClassificationResult[]`
   d. `executeSkillActions(phoneNumber, classifications)`
3. Logs cycle summary (users processed, emails found, skills matched)

#### Server integration

**`src/index.ts`** changes:
- Import `startEmailWatcher`, `stopEmailWatcher`
- Start after memory processor (inside `app.listen` callback): `if (config.emailWatcher.enabled) startEmailWatcher();`
- Add `stopEmailWatcher()` to `shutdown()` function

#### OAuth callback hook

**`src/routes/auth.ts`** change:
- Import `initEmailWatcherState` from `skills.ts`
- Call `await initEmailWatcherState(phoneNumber)` in `continueAfterAuth()` after credential storage

**Acceptance criteria**:
- Poller starts/stops cleanly
- Per-user error isolation (one user's failure doesn't block others)
- Overlap prevention (built into `createIntervalPoller`)
- Shutdown cleans up
- OAuth triggers skill seeding

---

### 3B — SMS Skill Management Tools + Email Agent Updates

**File**: `src/tools/email-skills.ts`

Six new tool definitions following the `{ tool: Tool, handler: ToolHandler }` pattern.

#### Tools

| Tool | Input | Behavior |
|------|-------|----------|
| `create_email_skill` | `{ name, description, matchCriteria, extractFields, actionType, actionPrompt, tools? }` | Validate → create → return confirmation |
| `list_email_skills` | `{}` | Return all skills for user (enabled + disabled) |
| `update_email_skill` | `{ name, updates: Partial<EmailSkill> }` | Lookup by name → validate changes → update |
| `delete_email_skill` | `{ name }` | Lookup by name → delete |
| `toggle_email_watcher` | `{ enabled }` | Update `email_watcher_enabled` in user_config |
| `test_email_skill` | `{ skillName, count? }` | Fetch last N emails → run classifier with just this skill → return matches (no actions) |

**Implementation notes**:
- `create_email_skill`: the handler receives raw user intent from the LLM; the LLM generates the full skill definition (matchCriteria, extractFields, etc.) as tool input
- `test_email_skill`: reuses `syncNewEmails` logic but fetches via `messages.list` (last N messages) instead of history sync, and calls classifier in dry-run mode
- All tools access phone number from `context.phoneNumber`
- Validation via `validateSkillDefinition()` from skills.ts — return validation errors as tool output (not thrown exceptions)

#### Register tools

**`src/tools/index.ts`**: Import and add all 6 tools to `allTools` array.

#### Update email agent

**`src/agents/email/index.ts`**:
- Add 6 new tool names to `EMAIL_TOOLS` array
- Update `capability.description` to mention skill management
- Add skill-related examples to `capability.examples`

**`src/agents/email/prompt.ts`**:
- Add the "Email Skill Management" prompt section from the design doc (the full block covering when to ask clarifying questions, how to handle create/update/delete)

**Acceptance criteria**:
- All 6 tools registered and callable
- Email agent routes skill management requests
- `create_email_skill` validates before saving
- `test_email_skill` runs dry (no side effects)
- Planner can route "show my email skills" to email-agent

---

### 3C — OAuth Callback Hook

Covered in 3A (the `initEmailWatcherState` call). Listed separately for clarity — this is a 2-line change in `src/routes/auth.ts` and can be done by any agent touching that file.

---

## Phase 4: Admin UI

Fully independent workstream. Only depends on Phase 1 (sqlite CRUD) and the API endpoints below.

### 4A — Admin API Endpoints

**File**: `src/admin/email-skills.ts`

Express route handlers for the admin API. Follow the exact pattern in `src/admin/memory.ts`.

| Endpoint | Handler | Notes |
|----------|---------|-------|
| `GET /admin/api/email-skills` | `listSkills` | Query param `?phone=` optional filter. Returns all skills. |
| `POST /admin/api/email-skills` | `createSkill` | Body: full skill definition. Validate before save. |
| `PUT /admin/api/email-skills/:id` | `updateSkill` | Body: partial updates. Validate changed fields. |
| `DELETE /admin/api/email-skills/:id` | `deleteSkill` | |
| `PATCH /admin/api/email-skills/:id/toggle` | `toggleSkill` | Body: `{ enabled: boolean }` |
| `GET /admin/api/email-watcher/status` | `watcherStatus` | Return per-user: enabled, historyId, last sync info |
| `POST /admin/api/email-watcher/toggle` | `toggleWatcher` | Body: `{ phoneNumber, enabled }` |

**Register routes** in `src/admin/index.ts`:
- Import handlers
- Add HTML page route: `GET /admin/email-skills` → serve `email-skills.html`
- Add all API routes

**Acceptance criteria**:
- All endpoints return JSON
- Validation errors return 400 with descriptive messages
- 404 for missing skill IDs
- No auth required (admin routes are internal only, same as memory)

---

### 4B — Admin HTML Page

**File**: `src/admin/views/email-skills.html`

Self-contained HTML with embedded CSS and JS. Follow the pattern in `memory.html`:

- Light/dark theme toggle with `localStorage`
- CSS variables for theming
- Vanilla JS with `fetch()` API calls
- `escapeHtml()` for all user-generated content

**Page sections**:
1. **Header**: "Email Skills Manager" + theme toggle
2. **Watcher status bar**: Running/paused indicator, pause/resume button
3. **Skill cards**: One card per skill showing name, match criteria preview, action type, enabled toggle, edit/delete buttons
4. **Edit modal**: Form with fields for `name`, `description`, `matchCriteria`, `extractFields` (comma-separated input), `actionType` (dropdown), `actionPrompt`, `tools` (checkboxes from allowlist)
5. **Create button**: Opens the edit modal in create mode

**Acceptance criteria**:
- All CRUD operations work from the UI
- Toggle enable/disable updates immediately (optimistic UI)
- Edit modal pre-populates with current values
- XSS safe (all dynamic content escaped)
- Responsive layout
- Works in both light and dark mode

---

## Phase 5: Tests

Independent workstream. Each sub-task can run in parallel once the code it tests exists. All tests use Vitest. Mock all external services (Gmail API, Anthropic API, Twilio).

### 5A — Unit Tests: Data Layer

**Files**:
- `tests/unit/services/email-watcher/sqlite.test.ts`
- `tests/unit/services/user-config/sqlite.test.ts` (extend existing)

**email_skills sqlite tests**:
- CRUD operations (create, read, update, delete)
- `getSkillsForUser` with `enabledOnly` filter
- `getSkillByName` lookup
- `toggleSkill` on/off
- JSON round-trip for `extractFields` and `tools`
- UNIQUE constraint on `(phone_number, name)` — expect error on duplicate
- `deleteAllSkillsForUser` removes all and only that user's skills

**user_config extension tests**:
- New columns exist after initialization
- `getEmailWatcherUsers()` returns correct users (join logic)
- `getEmailWatcherUsers()` excludes users without credentials
- `getEmailWatcherUsers()` excludes users with `email_watcher_enabled = 0`
- `updateEmailWatcherState()` updates historyId without touching other fields

**Config tests** (extend existing or new file):
- Default values correct
- Validation catches bad `intervalMs`, `batchSize`, `confidenceThreshold`

---

### 5B — Unit Tests: Pipeline

**Files**:
- `tests/unit/services/email-watcher/sync.test.ts`
- `tests/unit/services/email-watcher/classifier.test.ts`
- `tests/unit/services/email-watcher/actions.test.ts`
- `tests/unit/services/email-watcher/skills.test.ts`

**sync tests**:
- `prepareEmailForClassification`: plain text email, HTML email, no-body email, attachment-only, whitespace normalization, 5000 char truncation, base64 inline image stripping
- `syncNewEmails`: first run (baseline), subsequent run (returns emails), pagination, INBOX filter, invalid historyId recovery
- Mock Gmail API responses

**classifier tests**:
- No active skills → no LLM call, empty results
- Single email, single match
- Single email, multi-match
- Batch of 5+ emails (verify batching)
- JSON parse failure → retry → fallback
- Confidence threshold filtering
- Mock Anthropic API

**actions tests**:
- `execute_with_tools` action: verify task string assembly (action_prompt + XML context)
- `notify` action: verify summary used directly
- Multi-match: notifications merged into single SMS
- Notification throttle: allow up to max, block excess
- Throttle window reset after 1 hour
- Action failure logged but doesn't block others
- Mock `executeWithTools`, `sendSms`

**skills tests**:
- `seedDefaultSkills`: creates 3 skills, idempotent on second call
- `validateSkillDefinition`: valid skill passes, bad actionType fails, empty tools fails for execute_with_tools, disallowed tools rejected, field length limits
- `initEmailWatcherState`: sets enabled + seeds skills

---

### 5C — Unit Tests: SMS Tools

**File**: `tests/unit/tools/email-skills.test.ts`

- `create_email_skill`: valid input → creates skill, invalid input → returns validation errors
- `list_email_skills`: returns all skills for user
- `update_email_skill`: updates specific fields, validates changes
- `delete_email_skill`: removes skill, 404 on missing name
- `toggle_email_watcher`: updates user_config
- `test_email_skill`: fetches emails + classifies without executing actions
- Mock sqlite store and Gmail API

---

### 5D — Unit Tests: Admin API

**File**: `tests/unit/admin/email-skills.test.ts`

Use Supertest against Express app (same pattern as existing admin tests if any).

- `GET /admin/api/email-skills` → 200 with skills array
- `POST /admin/api/email-skills` → 201 on success, 400 on validation error
- `PUT /admin/api/email-skills/:id` → 200 on success, 404 on missing
- `DELETE /admin/api/email-skills/:id` → 200 on success, 404 on missing
- `PATCH /admin/api/email-skills/:id/toggle` → 200
- `GET /admin/api/email-watcher/status` → 200 with status
- `POST /admin/api/email-watcher/toggle` → 200

---

### 5E — Integration Tests

**File**: `tests/integration/email-watcher.test.ts`

End-to-end pipeline test with mocked external services:

1. **Full cycle test**: Seed skills → mock Gmail history with 2 emails → run poller callback once → verify classifier called → verify actions executed → verify SMS sent
2. **No-match test**: All emails unmatched → no actions, no notifications
3. **Multi-match test**: One email matches 2 skills → both actions run, single merged SMS
4. **First-run test**: No historyId → baseline established, no processing
5. **Skill CRUD via tools**: Create skill → list → update → disable → delete (via tool handlers)

---

## Phase 6: Docs & Cleanup

### 6A — ARCHITECTURE.md Update

After all code is merged:

- Add email watcher to the "Background Processes" table (4th entry)
- Add `email_skills` to the credentials.db tables list
- Add new email-agent tools to the agent tools table
- Add email watcher config vars to the optional env vars section
- Update the architecture flow diagram if needed

---

## File Inventory (all new/modified files)

### New Files (11)

| File | Phase | Workstream |
|------|-------|------------|
| `src/services/email-watcher/types.ts` | 1 | 1A |
| `src/services/email-watcher/sqlite.ts` | 1 | 1C |
| `src/services/email-watcher/sync.ts` | 2 | 2A |
| `src/services/email-watcher/classifier.ts` | 2 | 2B |
| `src/services/email-watcher/prompt.ts` | 2 | 2B |
| `src/services/email-watcher/actions.ts` | 2 | 2C |
| `src/services/email-watcher/skills.ts` | 2 | 2D |
| `src/services/email-watcher/index.ts` | 3 | 3A |
| `src/tools/email-skills.ts` | 3 | 3B |
| `src/admin/email-skills.ts` | 4 | 4A |
| `src/admin/views/email-skills.html` | 4 | 4B |

### Modified Files (7)

| File | Phase | Change |
|------|-------|--------|
| `src/config.ts` | 1 | Add `emailWatcher` config block + validation |
| `src/services/user-config/sqlite.ts` | 1 | Add columns + new methods |
| `src/services/user-config/types.ts` | 1 | Add new fields to `UserConfig` |
| `src/tools/index.ts` | 3 | Register 6 new tools |
| `src/agents/email/index.ts` | 3 | Add tools to EMAIL_TOOLS + update capability |
| `src/agents/email/prompt.ts` | 3 | Add skill management prompt section |
| `src/index.ts` | 3 | Start/stop email watcher |
| `src/routes/auth.ts` | 3 | Call `initEmailWatcherState` post-OAuth |
| `src/admin/index.ts` | 4 | Register email-skills routes |
| `ARCHITECTURE.md` | 6 | Document new service |

### New Test Files (6)

| File | Phase |
|------|-------|
| `tests/unit/services/email-watcher/sqlite.test.ts` | 5A |
| `tests/unit/services/email-watcher/sync.test.ts` | 5B |
| `tests/unit/services/email-watcher/classifier.test.ts` | 5B |
| `tests/unit/services/email-watcher/actions.test.ts` | 5B |
| `tests/unit/services/email-watcher/skills.test.ts` | 5B |
| `tests/unit/tools/email-skills.test.ts` | 5C |
| `tests/unit/admin/email-skills.test.ts` | 5D |
| `tests/integration/email-watcher.test.ts` | 5E |

---

## Parallel Execution Summary

For an agent swarm, the maximum parallelism at each stage:

| Stage | Parallel Workstreams | Est. Complexity |
|-------|---------------------|-----------------|
| **Start** | 1A (types) | Small |
| **After 1A** | 1B, 1C, 1D | Small each |
| **After Phase 1** | 2A, 2B, 2C, 2D, 4A, 5A | Up to 6 agents |
| **After Phase 2** | 3A, 3B, 3C, 4B, 5B | Up to 5 agents |
| **After Phase 3** | 5C, 5D, 5E | Up to 3 agents |
| **Final** | 6A (docs) | Small |

**Critical path**: 1A → 1C/1D → 2A → 3A → 5E

The UI workstream (4A → 4B) and test workstreams (5A–5E) can run entirely in parallel with core development once their dependencies are met.
