# Gmail Integration Plan

## Overview

Add Gmail reading capability to the SMS assistant, allowing users to query their email through natural language text messages. Follows the same pattern established for Google Calendar integration.

**Initial Scope**: Read-only access (list emails, read email content). No sending/composing in this phase.

**Key Insight**: Gmail shares the same OAuth credentials as Calendar. Adding Gmail scope to the existing auth flow means users who've already connected get Gmail access after re-authenticating once.

---

## User Stories

```
As a user, I can text "Do I have any new emails?" and get my unread messages.
As a user, I can text "Any emails from John?" and see messages from that sender.
As a user, I can text "What's the email about the project deadline?" and find specific emails.
As a user, when I first ask about email, I receive an SMS link to connect my Google account.
```

---

## Implementation

### 1. Update OAuth Scopes

Add Gmail scope to existing `SCOPES` array in `src/routes/auth.ts`:

```typescript
// src/routes/auth.ts line 22-25
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',  // NEW
];
```

**Note**: Existing users will need to re-authenticate to grant Gmail access. The auth flow requests all scopes together.

### 2. Update Success Messages

Make auth success messages generic (not Calendar-specific):

**File**: `src/routes/auth.ts`

```typescript
// Line 219 - SMS confirmation
await sendSms(
  phoneNumber,
  "✅ Google account connected! You can now ask about your calendar and email."
);

// Line 307 - HTML success page
<p>✅ Google account is connected.</p>
```

### 3. Create Gmail Service

**File**: `src/services/google/gmail.ts`

Follow the same pattern as `calendar.ts` - self-contained with its own client factory:

```typescript
/**
 * @fileoverview Gmail service.
 *
 * Provides listEmails and getEmail functions with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { google, gmail_v1 } from 'googleapis';
import config from '../../config.js';
import { getCredentialStore } from '../credentials/index.js';
import { AuthRequiredError } from './calendar.js';  // Reuse existing error class

/**
 * Email returned by list operations.
 */
export interface Email {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
}

/**
 * Email with full body content.
 */
export interface EmailDetail extends Email {
  body: string;
}

/**
 * Create an OAuth2 client with stored credentials.
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Refresh an expired access token using the refresh token.
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error('Failed to refresh access token');
  }

  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date || Date.now() + 3600000,
  };
}

/**
 * Get an authenticated Gmail client for a phone number.
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getGmailClient(phoneNumber: string): Promise<gmail_v1.Gmail> {
  const store = getCredentialStore();
  let creds = await store.get(phoneNumber, 'google');

  if (!creds) {
    throw new AuthRequiredError(phoneNumber);
  }

  // Refresh if token expires in < 5 minutes
  const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
  if (creds.expiresAt < Date.now() + REFRESH_THRESHOLD_MS) {
    try {
      const refreshed = await refreshAccessToken(creds.refreshToken);
      creds = {
        ...creds,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      };
      await store.set(phoneNumber, 'google', creds);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Refreshed Google access token',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Token refresh failed, removing credentials',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }));
      await store.delete(phoneNumber, 'google');
      throw new AuthRequiredError(phoneNumber);
    }
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: creds.accessToken });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * List emails matching a query.
 *
 * @param phoneNumber - User's phone number
 * @param options - Query options
 * @returns Array of emails
 * @throws AuthRequiredError if not authenticated
 */
export async function listEmails(
  phoneNumber: string,
  options: {
    query?: string;
    maxResults?: number;
  } = {}
): Promise<Email[]> {
  const gmail = await getGmailClient(phoneNumber);
  const { query = 'is:inbox', maxResults = 10 } = options;

  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: query,
  });

  if (!response.data.messages?.length) {
    return [];
  }

  // Fetch metadata for each message
  const emails = await Promise.all(
    response.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value || '';

      return {
        id: msg.id!,
        threadId: msg.threadId!,
        from: getHeader('From'),
        subject: getHeader('Subject'),
        snippet: detail.data.snippet || '',
        date: getHeader('Date'),
        isUnread: detail.data.labelIds?.includes('UNREAD') || false,
      };
    })
  );

  return emails;
}

/**
 * Get full email content by ID.
 *
 * @param phoneNumber - User's phone number
 * @param emailId - Email ID
 * @returns Email with body content
 * @throws AuthRequiredError if not authenticated
 */
export async function getEmail(
  phoneNumber: string,
  emailId: string
): Promise<EmailDetail | null> {
  const gmail = await getGmailClient(phoneNumber);

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: emailId,
    format: 'full',
  });

  if (!response.data) return null;

  const headers = response.data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name === name)?.value || '';

  const body = extractBodyText(response.data.payload);

  return {
    id: response.data.id!,
    threadId: response.data.threadId!,
    from: getHeader('From'),
    subject: getHeader('Subject'),
    snippet: response.data.snippet || '',
    date: getHeader('Date'),
    isUnread: response.data.labelIds?.includes('UNREAD') || false,
    body,
  };
}

/**
 * Extract plain text body from Gmail message payload.
 */
function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Direct body (simple messages)
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // Multipart - find text/plain part
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      // Recurse into nested parts (e.g., multipart/alternative)
      const nested = extractBodyText(part);
      if (nested) return nested;
    }
  }

  return '';
}
```

### 4. Add Gmail Tool Definitions

Add to `TOOLS` array in `src/llm.ts`:

```typescript
{
  name: 'get_emails',
  description: `Search and retrieve emails from the user's Gmail inbox.

Use for checking unread emails, finding emails from specific senders, or searching by subject/content.

Query examples:
- "is:unread" - unread emails
- "from:john@example.com" - emails from John
- "subject:meeting" - emails about meetings
- "newer_than:1d" - emails from last 24 hours
- "has:attachment" - emails with attachments
- Combine: "is:unread from:boss"

Returns sender, subject, date, and preview snippet.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search query (default: "is:inbox"). Examples: "is:unread", "from:boss@company.com"',
      },
      max_results: {
        type: 'number',
        description: 'Maximum emails to return (default: 5, max: 10)',
      },
    },
    required: [],
  },
},
{
  name: 'read_email',
  description: `Get the full content of a specific email by its ID.

Use after get_emails when the user wants to read the full message, not just the preview.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      email_id: {
        type: 'string',
        description: 'The email ID from get_emails',
      },
    },
    required: ['email_id'],
  },
},
```

### 5. Add Gmail Tool Handlers

Add to `handleToolCall` in `src/llm.ts`:

```typescript
if (toolName === 'get_emails') {
  if (!phoneNumber) {
    return JSON.stringify({ success: false, error: 'Phone number not available' });
  }

  const { query, max_results } = toolInput as {
    query?: string;
    max_results?: number;
  };

  try {
    const emails = await listEmails(phoneNumber, {
      query: query || 'is:unread',
      maxResults: Math.min(max_results || 5, 10),
    });

    console.log(JSON.stringify({
      level: 'info',
      message: 'Fetched emails',
      count: emails.length,
      query: query || 'is:unread',
      timestamp: new Date().toISOString(),
    }));

    return JSON.stringify({
      success: true,
      count: emails.length,
      emails: emails.map((e) => ({
        id: e.id,
        from: e.from,
        subject: e.subject,
        snippet: e.snippet,
        date: e.date,
        unread: e.isUnread,
      })),
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      const authUrl = generateAuthUrl(phoneNumber);
      return JSON.stringify({
        success: false,
        auth_required: true,
        auth_url: authUrl,
      });
    }
    console.error(JSON.stringify({
      level: 'error',
      message: 'Email fetch failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (toolName === 'read_email') {
  if (!phoneNumber) {
    return JSON.stringify({ success: false, error: 'Phone number not available' });
  }

  const { email_id } = toolInput as { email_id: string };

  try {
    const email = await getEmail(phoneNumber, email_id);

    if (!email) {
      return JSON.stringify({ success: false, error: 'Email not found' });
    }

    // Truncate body for SMS-friendly response
    const maxBodyLength = 500;
    const truncatedBody = email.body.length > maxBodyLength
      ? email.body.substring(0, maxBodyLength) + '...'
      : email.body;

    console.log(JSON.stringify({
      level: 'info',
      message: 'Read email',
      emailId: email_id,
      bodyLength: email.body.length,
      timestamp: new Date().toISOString(),
    }));

    return JSON.stringify({
      success: true,
      email: {
        from: email.from,
        subject: email.subject,
        date: email.date,
        body: truncatedBody,
      },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      const authUrl = generateAuthUrl(phoneNumber);
      return JSON.stringify({
        success: false,
        auth_required: true,
        auth_url: authUrl,
      });
    }
    console.error(JSON.stringify({
      level: 'error',
      message: 'Email read failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

### 6. Update System Prompt

Add Gmail section to `SYSTEM_PROMPT` in `src/llm.ts`:

```typescript
## Gmail Integration

You can access the user's Gmail using the get_emails and read_email tools.

If a Gmail tool returns auth_required: true, tell the user to tap the link to connect their Google account.

When listing emails, format them concisely for SMS:
- Show sender name (not full email), subject, and relative time
- Keep it scannable

Example response for "Any new emails?":
"You have 3 unread emails:
1. John Smith - Project update (2h ago)
2. Amazon - Your order shipped (5h ago)
3. Mom - Dinner Sunday? (yesterday)"

For reading full emails, summarize if the content is long.
```

### 7. Update READ_ONLY_TOOLS

Add Gmail tools to the safe list for scheduled jobs:

```typescript
export const READ_ONLY_TOOLS = TOOLS.filter((t) =>
  ['get_calendar_events', 'resolve_date', 'get_emails', 'read_email'].includes(t.name)
);
```

### 8. Add Import

Add to imports at top of `src/llm.ts`:

```typescript
import { listEmails, getEmail } from './services/google/gmail.js';
```

---

## File Summary

| File | Change |
|------|--------|
| `src/routes/auth.ts` | Add Gmail scope, update success messages |
| `src/services/google/gmail.ts` | **NEW** - Gmail service |
| `src/llm.ts` | Add tools, handlers, import, system prompt section |

**3 files touched, 1 new file.**

---

## Implementation Order

1. Add Gmail scope to `SCOPES` in auth.ts
2. Update success messages in auth.ts (SMS + HTML)
3. Create `gmail.ts` service
4. Add tool definitions to llm.ts
5. Add tool handlers to llm.ts
6. Add import and update system prompt
7. Update READ_ONLY_TOOLS
8. Test end-to-end

---

## Google Cloud Setup

Enable Gmail API in existing project:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select the Hermes project
3. Go to **APIs & Services > Library**
4. Search for "Gmail API" and enable it
5. Update OAuth consent screen:
   - Add scope: `https://www.googleapis.com/auth/gmail.readonly`

No credential changes needed - same OAuth client.

---

## Testing

### Unit Tests

**File**: `tests/unit/services/google/gmail.test.ts`

```typescript
describe('Gmail Service', () => {
  it('lists emails for authenticated user');
  it('throws AuthRequiredError when no credentials');
  it('extracts plain text body from multipart email');
  it('handles empty inbox gracefully');
});
```

### Integration Tests

**File**: `tests/integration/gmail-flow.test.ts`

```typescript
describe('Gmail Integration', () => {
  it('returns auth_required when not authenticated');
  it('returns email list for authenticated user');
  it('returns full email content with read_email');
});
```

---

## Security Notes

- **Read-only scope**: Using `gmail.readonly`, not `gmail.modify`
- **No email content in logs**: Only log metadata (count, IDs), not content
- **Body truncation**: Limit to 500 chars for SMS responses
- **Shared credentials**: Same encrypted token as Calendar (AES-256-GCM)

---

## Future Enhancements (Not in Scope)

- Mark as read/unread
- Send emails
- Reply to emails
- Archive/delete
- Attachment handling

These require additional scopes (`gmail.modify`, `gmail.send`).

---

## Example Flows

**Check unread emails:**
```
User: "Do I have any new emails?"
LLM: get_emails(query="is:unread")
Response: { success: true, count: 2, emails: [...] }
LLM: "You have 2 unread emails:
1. John - Meeting tomorrow (10 min ago)
2. Amazon - Order shipped (2h ago)"
```

**Search for sender:**
```
User: "Any emails from my boss?"
LLM: get_emails(query="from:boss@company.com")
Response: { success: true, count: 3, emails: [...] }
LLM: "Found 3 emails from your boss:
1. Q4 Review - yesterday
2. Re: Budget - 2 days ago
3. Team Update - last week"
```

**Read full email:**
```
User: "Read the first one"
LLM: read_email(email_id="abc123")
Response: { success: true, email: { body: "Hi, the Q4 review is scheduled for..." } }
LLM: "From: Boss
Subject: Q4 Review

Hi, the Q4 review is scheduled for Friday at 2pm.
Please prepare your department summary..."
```

**First-time auth:**
```
User: "Check my email"
LLM: get_emails()
Response: { success: false, auth_required: true, auth_url: "https://..." }
LLM: "To access your email, tap this link: https://hermes.example.com/auth/google?state=xyz"
```
