# Phase 5: Google Calendar Integration

## Overview

Integrate Google Calendar with the SMS-based assistant, allowing users to query and manage their calendar through natural language text messages.

**Key Challenge**: The assistant has no login page. Users authenticate via an SMS link that opens a browser OAuth flow, with tokens stored server-side.

---

## User Stories

```
As a user, I can text "What's on my calendar today?" and get my events.
As a user, I can text "When am I free this week?" and see my availability.
As a user, I can text "Schedule a meeting with John tomorrow at 2pm" and have it created.
As a user, when I first ask about my calendar, I receive an SMS link to connect my Google account.
As a user, I can text "Disconnect my Google account" to revoke access.
```

---

## Architecture

### Authentication Flow (SMS-Friendly OAuth)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         SMS OAuth Flow                                   │
└──────────────────────────────────────────────────────────────────────────┘

1. User texts: "What's on my calendar?"
                    │
                    ▼
2. Assistant checks: Does this phone number have a valid Google token?
                    │
         ┌──────────┴──────────┐
         │ NO                  │ YES
         ▼                     ▼
3a. Generate auth state       3b. Use existing token
    (phoneNumber + nonce)         to query calendar
         │                         │
         ▼                         ▼
4a. Send SMS:                 4b. Return calendar
    "To access your calendar,     results via SMS
     tap: https://hermes.example.com/auth/google?state=xyz"
         │
         ▼
5. User taps link in SMS
         │
         ▼
6. Browser redirects to Google OAuth consent screen
         │
         ▼
7. User grants calendar access
         │
         ▼
8. Google redirects to: /auth/google/callback?code=abc&state=xyz
         │
         ▼
9. Server:
   - Validates state (extracts phone number)
   - Exchanges code for tokens (access + refresh)
   - Encrypts and stores tokens keyed by phone number
   - Sends SMS: "Google Calendar connected! Try: What's on my calendar?"
         │
         ▼
10. Browser shows success page: "All set! Return to your SMS app."
```

### Token Storage

```
┌─────────────────────────────────────────────────────────────────┐
│                    Credential Store                              │
├─────────────────────────────────────────────────────────────────┤
│  Phone Number  │  Provider  │  Encrypted Tokens  │  Expires At  │
├─────────────────────────────────────────────────────────────────┤
│  +1234567890   │  google    │  {encrypted blob}  │  2025-02-01  │
└─────────────────────────────────────────────────────────────────┘

Tokens include:
- access_token (short-lived, ~1 hour)
- refresh_token (long-lived, used to get new access tokens)
- token_type: "Bearer"
- expiry_date: timestamp
```

### Component Integration

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Existing Architecture                          │
│                                                                     │
│   SMS → Message Handler → LLM (Claude) → Tools → Response → SMS    │
│                                │                                    │
│                                ▼                                    │
│                    ┌──────────────────────────┐                    │
│                    │    CALENDAR COMPONENTS    │                    │
│                    ├──────────────────────────┤                    │
│                    │ • get_calendar_events    │ ◄─── LLM Tools     │
│                    │ • create_calendar_event  │                    │
│                    │ • update_calendar_event  │                    │
│                    │ • delete_calendar_event  │                    │
│                    │ • resolve_date           │                    │
│                    ├──────────────────────────┤                    │
│                    │ • listEvents()           │ ◄─── Calendar Svc  │
│                    │ • createEvent()          │                    │
│                    │ • updateEvent()          │                    │
│                    │ • deleteEvent()          │                    │
│                    │ • getEvent()             │                    │
│                    ├──────────────────────────┤                    │
│                    │ • CredentialStore        │ ◄─── Token Storage │
│                    ├──────────────────────────┤                    │
│                    │ • /auth/google/*         │ ◄─── OAuth Routes  │
│                    └──────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Step 1: Credential Store

| | |
|---|---|
| **What** | Encrypted storage for OAuth tokens, keyed by phone number. Interface + SQLite implementation. |
| **Why** | Users' Google tokens must persist across server restarts and be encrypted at rest. The interface allows swapping storage backends later without changing other code. |
| **Success Criteria** | Can store, retrieve, and delete credentials. Tokens are encrypted in the database file. Works in dev (local file) and production (Railway volume). |

**Design Goal**: Abstract storage behind an interface so we can swap providers later (e.g., move from SQLite to Postgres or DynamoDB) without changing any other code.

**File**: `src/services/credentials/types.ts`

```typescript
interface StoredCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;        // Unix timestamp
}

interface CredentialStore {
  get(phoneNumber: string, provider: string): Promise<StoredCredential | null>;
  set(phoneNumber: string, provider: string, credential: StoredCredential): Promise<void>;
  delete(phoneNumber: string, provider: string): Promise<void>;
}
```

Note: No `exists()` method - use `get()` returning null instead. No `scopes` field - we always request the same scopes.

**File**: `src/services/credentials/provider-factory.ts`

```typescript
import { SqliteCredentialStore } from './providers/sqlite.js';
import { MemoryCredentialStore } from './providers/memory.js';

export function getCredentialStore(): CredentialStore {
  switch (config.credentials.provider) {
    case 'sqlite':
      return new SqliteCredentialStore(config.credentials.sqlitePath);
    // Future providers (not implemented now):
    // case 'postgres':
    //   return new PostgresCredentialStore(config.credentials.postgresUrl);
    // case 'dynamodb':
    //   return new DynamoCredentialStore(config.credentials.dynamoTable);
    default:
      return new MemoryCredentialStore(); // testing only
  }
}
```

**Implementation (Phase 5a)**: SQLite only - works for both dev and production.

| Environment | SQLite Path | Persistence |
|-------------|-------------|-------------|
| Dev (laptop) | `./data/credentials.db` | Survives server restarts, gitignored |
| Railway | `/app/data/credentials.db` | Railway Volume, survives deploys |
| Tests | N/A (memory provider) | Ephemeral |

**Environment Configuration**:

```bash
# Development (.env)
CREDENTIAL_STORE_PROVIDER=sqlite
CREDENTIAL_STORE_SQLITE_PATH=./data/credentials.db

# Production (Railway)
CREDENTIAL_STORE_PROVIDER=sqlite
CREDENTIAL_STORE_SQLITE_PATH=/app/data/credentials.db
```

**Railway Volume** (add to `railway.toml`):

```toml
[[mounts]]
source = "data"
destination = "/app/data"
```

**Future Portability**: To switch to Postgres/DynamoDB later:
1. Implement new provider class (e.g., `PostgresCredentialStore`)
2. Add case to factory
3. Change `CREDENTIAL_STORE_PROVIDER` env var
4. No changes to calendar service, tools, or any other code

**Encryption Approach**:
- Use `CREDENTIAL_ENCRYPTION_KEY` from environment (32-byte key)
- AES-256-GCM for authenticated encryption
- Each credential encrypted independently with unique IV
- Encryption happens in the provider, not the interface

### Step 2: OAuth Routes

| | |
|---|---|
| **What** | Two HTTP endpoints: `/auth/google` (start OAuth) and `/auth/google/callback` (receive tokens from Google). |
| **Why** | SMS has no way to do OAuth directly. User taps a link in SMS → browser OAuth flow → callback stores tokens → SMS confirmation. This bridges SMS to web auth. |
| **Success Criteria** | User receives auth link via SMS, taps it, completes Google consent, gets "Connected!" SMS, and credentials are stored. Expired/invalid state params are rejected. |

**File**: `src/routes/auth.ts`

```typescript
// GET /auth/google
// Initiates OAuth flow - redirects to Google
router.get('/auth/google', (req, res) => {
  const state = req.query.state; // Contains encrypted phone number
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',      // Get refresh token
    scope: GOOGLE_CALENDAR_SCOPES,
    state: state,
    prompt: 'consent',           // Force consent to get refresh token
  });
  res.redirect(authUrl);
});

// GET /auth/google/callback
// Handles OAuth callback from Google
router.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;

  // 1. Validate and decrypt state to get phone number
  const phoneNumber = decryptState(state);

  // 2. Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);

  // 3. Store encrypted tokens
  await credentialStore.set(phoneNumber, 'google', {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date,
    scopes: tokens.scope.split(' '),
  });

  // 4. Notify user via SMS
  await sendSms(phoneNumber, "Google Calendar connected! Try asking: What's on my calendar today?");

  // 5. Show success page
  res.send(successHtml);
});
```

**State Parameter Security**:
- State = `encrypt(JSON.stringify({ phone: "+1234567890", exp: Date.now() + 600000 }))`
- Prevents CSRF: only our server can decrypt the state
- Expires after 10 minutes (checked on callback)
- No nonce tracking needed - expiry is sufficient for a 10-minute window

### Step 3: Google Calendar Service

| | |
|---|---|
| **What** | Five functions: `listEvents`, `createEvent`, `updateEvent`, `deleteEvent`, `getEvent`. Handles token refresh automatically via `withRetry`. |
| **Why** | Wraps Google Calendar API with our auth. Throws `AuthRequiredError` if no credentials exist, letting the tool handler respond with an auth link. |
| **Success Criteria** | Full CRUD on events for authenticated users. Automatically refreshes expired tokens. Throws clear error when user hasn't connected Google yet. Supports both timed and all-day events. |

**File**: `src/domains/calendar/providers/google-calendar.ts`

Plain functions, no class. No FreeBusy API - Claude can derive free time from the event list.

```typescript
import { google } from 'googleapis';
import { getCredentialStore } from '../credentials/provider-factory.js';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;       // ISO string
  end: string;         // ISO string
  location?: string;
}

// Get authenticated calendar client, refreshing token if needed
async function getCalendarClient(phoneNumber: string) {
  const store = getCredentialStore();
  const creds = await store.get(phoneNumber, 'google');

  if (!creds) {
    throw new AuthRequiredError(phoneNumber);
  }

  // Refresh if token expires in < 5 minutes
  if (creds.expiresAt < Date.now() + 300000) {
    const newTokens = await refreshGoogleToken(creds.refreshToken);
    await store.set(phoneNumber, 'google', {
      ...creds,
      accessToken: newTokens.access_token,
      expiresAt: newTokens.expiry_date,
    });
    creds.accessToken = newTokens.access_token;
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: creds.accessToken });
  return google.calendar({ version: 'v3', auth });
}

export async function listEvents(
  phoneNumber: string,
  timeMin: Date,
  timeMax: Date
): Promise<CalendarEvent[]> {
  const calendar = await getCalendarClient(phoneNumber);
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });

  return (response.data.items || []).map(event => ({
    id: event.id!,
    title: event.summary || '(No title)',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    location: event.location,
  }));
}

export async function createEvent(
  phoneNumber: string,
  title: string,
  start: Date,
  end: Date,
  location?: string
): Promise<CalendarEvent> {
  const calendar = await getCalendarClient(phoneNumber);
  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      location,
    },
  });

  return {
    id: response.data.id!,
    title: response.data.summary || title,
    start: response.data.start?.dateTime || '',
    end: response.data.end?.dateTime || '',
    location: response.data.location,
  };
}
```

Note: No `getFreeBusy()` - when user asks "when am I free?", we list events and let Claude identify gaps. Simpler and avoids an extra API.

### Step 4: Calendar Tools for LLM

| | |
|---|---|
| **What** | Five Claude tools: `get_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, and `resolve_date`. Registered via the calendar agent's tool list. |
| **Why** | Full CRUD lets Claude manage calendar events on behalf of the user. `resolve_date` lets the LLM verify date interpretation. When auth is missing, tools return `auth_required: true` with a link. All tools validate inputs at the boundary before calling the service layer. |
| **Success Criteria** | "What's on my calendar today?" returns events. "Schedule lunch tomorrow at noon" creates an event. "Move my 3pm to 4pm" updates it. "Cancel my dentist" deletes it. All tools handle auth errors, Google API 404/403/429 errors, and invalid inputs gracefully. |

**File**: `src/domains/calendar/runtime/tools.ts`

Full CRUD plus date resolution. Tools accept natural language dates via the unified date resolver.

```typescript
const CALENDAR_TOOLS: Tool[] = [
  {
    name: 'get_calendar_events',
    description: 'Get events from the user\'s Google Calendar. Use for schedule queries, finding free time, checking availability.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start of time range (ISO 8601, e.g. "2025-01-20T00:00:00")',
        },
        end_date: {
          type: 'string',
          description: 'End of time range (ISO 8601). Defaults to end of start_date day if not provided.',
        },
      },
      required: ['start_date'],
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Create a new event on the user\'s Google Calendar.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start_time: { type: 'string', description: 'Start time (ISO 8601)' },
        end_time: { type: 'string', description: 'End time (ISO 8601). Defaults to 1 hour after start.' },
        location: { type: 'string', description: 'Location (optional)' },
      },
      required: ['title', 'start_time'],
    },
  },
];
```

**Tool Handler** (in `handleToolCall`):

```typescript
if (toolName === 'get_calendar_events') {
  try {
    const { start_date, end_date } = toolInput as { start_date: string; end_date?: string };
    const startDate = new Date(start_date);
    const endDate = end_date ? new Date(end_date) : endOfDay(startDate);

    const events = await listEvents(context.phoneNumber, startDate, endDate);
    return JSON.stringify({ success: true, events });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      const authUrl = generateAuthUrl(context.phoneNumber);
      return JSON.stringify({
        success: false,
        auth_required: true,
        auth_url: authUrl,
      });
    }
    throw error;
  }
}

if (toolName === 'create_calendar_event') {
  try {
    const { title, start_time, end_time, location } = toolInput as {
      title: string; start_time: string; end_time?: string; location?: string;
    };
    const start = new Date(start_time);
    const end = end_time ? new Date(end_time) : new Date(start.getTime() + 3600000); // +1 hour

    const event = await createEvent(context.phoneNumber, title, start, end, location);
    return JSON.stringify({ success: true, event });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      const authUrl = generateAuthUrl(context.phoneNumber);
      return JSON.stringify({ success: false, auth_required: true, auth_url: authUrl });
    }
    throw error;
  }
}
```

Note: Date parsing uses native `new Date()`. If this proves insufficient for edge cases, add a library later.

### Step 5: LLM System Prompt Updates

| | |
|---|---|
| **What** | One line added to Claude's system prompt about handling auth_required responses. |
| **Why** | Claude needs to know how to communicate auth links to users naturally. The tool descriptions handle everything else. |
| **Success Criteria** | When user asks about calendar without being connected, Claude responds with something like "To access your calendar, tap this link: [url]" rather than a confusing error. |

Minimal additions - Claude understands tool descriptions well. Just add:

```typescript
// Add to system prompt
`If a calendar tool returns auth_required: true, tell the user to tap the link to connect their Google Calendar.`
```

No need for extensive instructions. The tool descriptions are self-explanatory.

### Step 6: Tests

| | |
|---|---|
| **What** | Unit tests for credential store and calendar service. Integration tests for the full OAuth and calendar query flows. |
| **Why** | Verify core functionality works. Catch regressions. Tests use mocks for Google API - no real Google calls in tests. |
| **Success Criteria** | `npm test` passes. Core flows are covered: store/retrieve credentials, list events, create events, auth flow. |

**Principle**: Test the important paths, not every edge case. Google's API has many quirks - don't try to mock them all.

**Unit Tests** (`tests/unit/`):

```typescript
// credentials/sqlite.test.ts
describe('SqliteCredentialStore', () => {
  it('stores and retrieves credentials', async () => {
    const store = new SqliteCredentialStore(':memory:');
    await store.set('+1234567890', 'google', mockCredential);
    const result = await store.get('+1234567890', 'google');
    expect(result).toEqual(mockCredential);
  });

  it('returns null for unknown phone number', async () => {
    const store = new SqliteCredentialStore(':memory:');
    const result = await store.get('+9999999999', 'google');
    expect(result).toBeNull();
  });

  it('encrypts tokens in database', async () => {
    // Verify raw DB content is not plaintext
  });

  it('deletes credentials', async () => {
    // store, delete, verify get returns null
  });
});

// google/calendar.test.ts
describe('Calendar Service', () => {
  it('lists events for authenticated user', async () => {
    // Mock credential store with valid token
    // Mock googleapis response
    // Verify mapped events returned
  });

  it('throws AuthRequiredError when no credentials', async () => {
    // Mock empty credential store
    // Verify AuthRequiredError thrown
  });

  it('refreshes expired token before API call', async () => {
    // Mock credential store with expired token
    // Mock token refresh endpoint
    // Verify new token stored and API call succeeds
  });
});
```

**Integration Tests** (`tests/integration/`):

Happy path only - verify the pieces work together.

```typescript
// calendar-flow.test.ts
describe('Calendar Integration', () => {
  it('full auth flow: generate link → callback → credentials stored', async () => {
    // 1. Call generateAuthUrl('+1234567890')
    // 2. Simulate callback with mock code
    // 3. Verify credentials stored
    // 4. Verify SMS sent (mock Twilio)
  });

  it('calendar query returns events for authenticated user', async () => {
    // 1. Pre-store test credentials
    // 2. Call tool handler with get_calendar_events
    // 3. Verify events returned (mock Google API)
  });

  it('calendar query returns auth_required when not authenticated', async () => {
    // 1. No credentials stored
    // 2. Call tool handler with get_calendar_events
    // 3. Verify auth_required: true with auth_url
  });
});
```

**What we DON'T test:**
- Every Google API error code
- Rate limiting scenarios
- Network failures (rely on googleapis library)
- Edge cases in date parsing (fix when they occur)

**Mocks needed:**
- `tests/mocks/google-calendar.ts` - Mock Google Calendar API responses
- Reuse existing `tests/mocks/twilio.ts` for SMS verification

---

## Security Considerations

### Token Security
- **Encryption at rest**: AES-256-GCM with environment-provided key
- **No tokens in logs**: Redact tokens from any log output
- **Minimal scopes**: Request only `calendar.readonly` and `calendar.events` (not full Google access)
- **Token in memory**: Decrypted tokens held only for API call duration

### OAuth Security
- **State parameter**: Encrypted, time-limited, single-use
- **HTTPS only**: All auth endpoints require HTTPS
- **Redirect URI validation**: Only allow configured callback URL

### SMS Security
- **No tokens in SMS**: Never send access/refresh tokens via SMS
- **Short-lived auth links**: State expires in 10 minutes
- **Phone verification**: Phone number is implicit user identity

---

## Google Cloud Setup

### 1. Create OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Calendar API**
4. Go to **APIs & Services > Credentials**
5. Create **OAuth 2.0 Client ID** (Web application type)
6. Add authorized redirect URI: `https://your-domain.com/auth/google/callback`
7. Copy Client ID and Client Secret

### 2. Configure OAuth Consent Screen

1. Go to **OAuth consent screen**
2. Select **External** user type
3. Fill in app name, support email
4. Add scopes:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
5. Add test users (while in testing mode)

### 3. Environment Variables

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-domain.com/auth/google/callback

# Credential Storage
CREDENTIAL_STORE_PROVIDER=sqlite
CREDENTIAL_STORE_SQLITE_PATH=./data/credentials.db  # or /app/data/credentials.db on Railway

# Encryption (generate with: openssl rand -hex 32)
CREDENTIAL_ENCRYPTION_KEY=your-32-byte-hex-key
```

---

## Testing Strategy

### Unit Tests

```typescript
// tests/services/google/calendar.test.ts
describe('GoogleCalendarService', () => {
  it('lists events for authenticated user', async () => {
    // Mock credential store with valid token
    // Mock Google API response
    // Verify events are mapped correctly
  });

  it('throws AuthRequiredError when no credentials', async () => {
    // Mock empty credential store
    // Verify correct error thrown
  });

  it('refreshes expired token automatically', async () => {
    // Mock credential store with expired token
    // Mock token refresh
    // Verify new token is stored
  });
});
```

### Integration Tests

```typescript
// tests/integration/calendar-flow.test.ts
describe('Calendar SMS Flow', () => {
  it('prompts for auth when user asks about calendar without credentials', async () => {
    const response = await sendTestSms("What's on my calendar?");
    expect(response).toContain('tap this link');
    expect(response).toContain('/auth/google');
  });

  it('returns events when user is authenticated', async () => {
    // Setup: Store test credentials
    const response = await sendTestSms("What's on my calendar today?");
    expect(response).toContain('meeting'); // or "no events"
  });
});
```

### Manual Testing Checklist

- [ ] First-time user asks about calendar → receives auth link
- [ ] User clicks link → redirected to Google consent
- [ ] User grants access → receives confirmation SMS
- [ ] User asks about calendar again → receives events
- [ ] Token refresh works after 1 hour
- [ ] User can disconnect → credentials deleted
- [ ] Invalid/revoked token → prompts re-auth

---

## File Structure

Simplified - fewer files, encryption logic lives inside SQLite provider.

```
src/
├── routes/
│   ├── auth.ts                    # NEW: OAuth routes + state encrypt/decrypt
│   └── sms.ts                     # Existing
├── services/
│   ├── credentials/
│   │   ├── types.ts               # NEW: CredentialStore interface
│   │   ├── index.ts               # NEW: getCredentialStore() factory
│   │   ├── sqlite.ts              # NEW: SQLite provider (includes encryption)
│   │   └── memory.ts              # NEW: In-memory provider (tests only)
│   └── google/
│       └── calendar.ts            # NEW: listEvents, createEvent functions
├── llm.ts                         # MODIFY: Add calendar tools
├── config.ts                      # MODIFY: Add Google + credentials config
└── index.ts                       # MODIFY: Add auth routes

tests/
├── mocks/
│   └── google-calendar.ts         # NEW: Mock Google Calendar API
├── unit/
│   ├── credentials-sqlite.test.ts # NEW: Credential store tests
│   └── calendar-service.test.ts   # NEW: Calendar function tests
└── integration/
    └── calendar-flow.test.ts      # NEW: End-to-end calendar tests

data/
└── credentials.db                 # SQLite database (gitignored)
```

**7 new source files + 4 test files**.

---

## Milestones

Consolidated from 4 phases to 3. Token refresh is built into Phase 5b from the start.

### Phase 5a: OAuth + Credential Storage
- [ ] Define CredentialStore interface
- [ ] Implement SQLite provider with AES-256-GCM encryption
- [ ] Implement Memory provider (tests)
- [ ] Add OAuth routes (`/auth/google`, `/auth/google/callback`)
- [ ] State parameter: encrypt phone + expiry, validate on callback
- [ ] Store tokens on successful auth
- [ ] Send confirmation SMS
- [ ] Add simple success/error HTML pages
- [ ] Add `data/` to `.gitignore`
- [ ] Update `.env.example` with new variables

### Phase 5b: Calendar Operations + Tests
- [ ] `listEvents()` function with automatic token refresh
- [ ] `createEvent()` function
- [ ] Add `get_calendar_events` tool
- [ ] Add `create_calendar_event` tool
- [ ] Handle `AuthRequiredError` → return auth URL in tool response
- [ ] Handle revoked tokens → prompt re-auth
- [ ] Default end time (1 hour) for events without duration
- [ ] Unit tests: credential store (4 tests), calendar service (3 tests)
- [ ] Integration tests: auth flow, calendar query, auth_required response (3 tests)
- [ ] Create `tests/mocks/google-calendar.ts`

### Phase 5c: Polish (only if needed)
- [ ] "Disconnect Google" command (delete credentials)
- [ ] Better error messages for API failures
- [ ] Rate limit handling

Note: No date parsing library initially. Use native `new Date()`. Add date-fns only if edge cases emerge.

---

## Open Questions

1. **Multi-calendar support**: Should we support calendars other than primary? (Recommendation: Start with primary only)

2. **Event details depth**: How much detail to include in SMS? (Recommendation: Title, time, location. Description on request.)

3. **Timezone handling**: Use user's calendar timezone or ask? (Recommendation: Use calendar's default timezone)

4. **Attendee invites**: Should create_event support inviting others? (Recommendation: Phase 5e, requires email scope)

5. **Recurring events**: How to handle "Schedule weekly standup"? (Recommendation: Phase 5e, start with single events)

---

## Dependencies

```json
{
  "googleapis": "^130.0.0",
  "better-sqlite3": "^11.0.0"
}
```

That's it. Two new dependencies.

**Why better-sqlite3?**
- Synchronous API (simpler code, no async overhead for local DB)
- Works in both dev and production
- No external database server

**Why no date library?**
- Native `new Date(isoString)` handles ISO 8601 strings fine
- LLM outputs ISO strings, Calendar API accepts/returns ISO strings
- Add date-fns later only if timezone edge cases cause problems

---

## Success Criteria

- User can connect Google Calendar via SMS link in < 60 seconds
- Calendar queries return results in < 5 seconds
- Events are formatted readably for SMS (< 160 chars per event summary)
- Token refresh is invisible to user
- Auth errors gracefully prompt re-authentication
