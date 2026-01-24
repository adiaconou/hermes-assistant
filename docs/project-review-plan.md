# Project Review Plan

Date: 2026-01-24
Updated: 2026-01-24 (Detailed Implementation Plan)

## Goals
- Reduce security/cost risk from unauthenticated webhooks and OAuth continuation issues.
- Improve correctness of post-auth and SMS response handling.
- Trim complexity that is not needed for the current phase.

---

## Executive Summary

Five priority fixes identified, ordered by security impact:

| # | Issue | Risk | Effort |
|---|-------|------|--------|
| 1 | Twilio signature validation missing | **Critical** - spoofed webhooks | Medium |
| 2 | Channel lost through OAuth flow | High - wrong delivery channel | Medium |
| 3 | Double continuation message injection | Medium - duplicate messages | Low |
| 4 | SMS length limits not enforced | Low - truncated messages | Low |
| 5 | Crypto decode non-deterministic | Low - edge case failures | Low |

---

## Recommendations (priority order)
1) Verify Twilio webhook signatures on /webhook/sms to prevent spoofed requests.
   - Touchpoints: `src/routes/sms.ts` (request handler), possibly a shared verification helper.
2) Preserve message channel through OAuth state and fix WhatsApp post-auth routing.
   - Include `channel` in encrypted state and use it in `continueAfterAuth`.
   - Ensure `sendWhatsApp` receives a raw phone number (no `whatsapp:` prefix).
3) Avoid double-injecting the continuation message after OAuth.
   - Only add the continuation message once (either in history or as the user message, not both).
4) Enforce SMS length limits for synchronous TwiML responses.
   - Clamp or summarize `classification.immediateResponse` to <=160 chars, or update the prompt to guarantee a short response.
5) Make crypto decode path deterministic.
   - Use explicit encoding for `decipher.update` + `decipher.final` instead of string concatenation.

---

## Detailed Implementation Plans

### 1) Verify Twilio webhook signatures

**Current State:**
- [src/routes/sms.ts:150-251](src/routes/sms.ts#L150-L251) - POST `/webhook/sms` handler has NO signature validation
- Anyone can POST to the endpoint and trigger LLM calls (cost + security risk)
- Twilio sends `X-Twilio-Signature` header with HMAC-SHA1 of request body

**Why This Is Important:**
> Without signature validation, the webhook endpoint is completely open to abuse. An attacker can:
> - **Trigger expensive LLM API calls** by sending fake messages, running up your Anthropic bill
> - **Inject malicious content** into user conversations or trigger unintended tool executions
> - **Impersonate any phone number** to access another user's context, calendar, or email
> - **Denial of service** by flooding the endpoint with requests
>
> This is the highest-priority fix because it's a **direct attack vector** with no authentication barrier. Every request currently costs money and could expose user data.

**Implementation Steps:**

#### Step 1.1: Capture raw body for signature verification
The Twilio signature is computed over the raw POST body. Express's `urlencoded` middleware parses the body, losing the raw form.

**File:** `src/index.ts`
```typescript
// Add verify callback to capture raw body for Twilio routes
app.use('/webhook', express.urlencoded({
  extended: false,
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf.toString('utf8');
  }
}));
```

**Issue to watch:** This `verify` callback runs for ALL `/webhook/*` routes. If other webhook routes don't need raw body, this is fine. Otherwise, be more specific with the route path.

#### Step 1.2: Create Twilio signature validation helper
**New file:** `src/services/twilio/validation.ts`
```typescript
import { validateRequest } from 'twilio';
import { config } from '../../config.js';

export function validateTwilioSignature(
  signature: string | undefined,
  url: string,
  params: Record<string, string>
): boolean {
  if (!signature) return false;
  return validateRequest(
    config.twilio.authToken,
    signature,
    url,
    params
  );
}
```

**Note:** The Twilio SDK's `validateRequest` function handles the HMAC-SHA1 computation. We need:
- `authToken` from config (already available at `config.twilio.authToken`)
- Full webhook URL (must include protocol, host, path)
- Parsed body params (the `req.body` object)
- The `X-Twilio-Signature` header value

#### Step 1.3: Add validation middleware to SMS route
**File:** `src/routes/sms.ts` - Add before the main handler (around line 150)

```typescript
// Validate Twilio signature before processing
const signature = req.headers['x-twilio-signature'] as string | undefined;
const fullUrl = `${config.server.baseUrl}/webhook/sms`;

if (!validateTwilioSignature(signature, fullUrl, req.body)) {
  console.warn('[SMS] Invalid Twilio signature - rejecting request');
  return res.status(403).send('Forbidden');
}
```

**Critical Issue:** `config.server.baseUrl` must match EXACTLY what Twilio sends. Common problems:
- HTTP vs HTTPS mismatch
- Trailing slash differences
- Port number differences (ngrok vs production)

**Recommendation:** Log the computed URL during development to debug mismatches.

#### Step 1.4: Handle development/testing bypass
For local development with ngrok, the URL changes frequently. Options:
1. **Environment toggle:** `SKIP_TWILIO_VALIDATION=true` for dev only
2. **Test mode detection:** Skip validation when `NODE_ENV=test`

```typescript
// In validation.ts
export function validateTwilioSignature(...): boolean {
  if (config.isDevelopment && process.env.SKIP_TWILIO_VALIDATION === 'true') {
    console.warn('[Twilio] Signature validation SKIPPED (dev mode)');
    return true;
  }
  // ... normal validation
}
```

**Security note:** NEVER ship with validation disabled. The toggle should only work in development.

#### Step 1.5: Tests for signature validation

**File:** `tests/twilio-validation.test.ts`

```typescript
describe('Twilio Signature Validation', () => {
  it('rejects requests without signature header', async () => {
    const response = await request(app)
      .post('/webhook/sms')
      .send({ From: '+1234567890', Body: 'test' })
      .expect(403);
  });

  it('rejects requests with invalid signature', async () => {
    const response = await request(app)
      .post('/webhook/sms')
      .set('X-Twilio-Signature', 'invalid-signature')
      .send({ From: '+1234567890', Body: 'test' })
      .expect(403);
  });

  it('accepts requests with valid signature', async () => {
    // Use Twilio SDK to compute valid signature for test
    const params = { From: '+1234567890', Body: 'test' };
    const validSignature = computeTestSignature(params);

    const response = await request(app)
      .post('/webhook/sms')
      .set('X-Twilio-Signature', validSignature)
      .send(params)
      .expect(200);
  });
});
```

**Dependencies:** None - this can be implemented first.

---

### 2) Preserve channel through OAuth state + fix WhatsApp post-auth

**Current State:**
- [src/routes/auth.ts:50-74](src/routes/auth.ts#L50-L74) - `encryptState()` only stores `{ phone, exp }`
- [src/routes/auth.ts:135-177](src/routes/auth.ts#L135-L177) - `continueAfterAuth()` infers channel from phone prefix
- [src/llm/tools/utils.ts:23-36](src/llm/tools/utils.ts#L23-L36) - `handleAuthError()` calls `generateAuthUrl(phoneNumber)` without channel
- Channel is available in `ToolContext` but not passed to `generateAuthUrl`

**Problem:** If a WhatsApp user authenticates, the post-auth response may be sent to the wrong channel because the channel is inferred from phone format rather than explicitly preserved.

**Why This Is Important:**
> The OAuth flow is a critical user experience moment - the user has just granted access to their Google account and expects the assistant to continue seamlessly. If the channel is lost:
> - **WhatsApp users receive SMS responses** (or vice versa), breaking their expected communication channel
> - **Users may miss the response entirely** if they're only monitoring one channel
> - **The assistant appears broken** at the exact moment the user completed a trust-building action
> - **Phone number format bugs** (double `whatsapp:` prefix) cause Twilio API failures, resulting in silent message drops
>
> This is a **user trust and reliability issue** - getting OAuth right builds confidence; getting it wrong makes users abandon the product.

**Implementation Steps:**

#### Step 2.1: Extend state payload to include channel
**File:** `src/routes/auth.ts`

**Update type definition (add around line 30):**
```typescript
interface OAuthState {
  phone: string;
  channel: 'sms' | 'whatsapp';
  exp: number;
}
```

**Update `encryptState()` (lines 50-74):**
```typescript
export function encryptState(
  phoneNumber: string,
  channel: 'sms' | 'whatsapp' = 'sms'
): string {
  const state: OAuthState = {
    phone: phoneNumber,
    channel,
    exp: Date.now() + STATE_EXPIRY_MS,
  };
  // ... rest unchanged
}
```

**Update `decryptState()` return type (lines 80-120):**
```typescript
export function decryptState(state: string): { phone: string; channel: 'sms' | 'whatsapp' } | null {
  // ... decryption logic unchanged

  const payload = JSON.parse(decrypted) as OAuthState;
  if (payload.exp < Date.now()) {
    return null;
  }
  return {
    phone: payload.phone,
    channel: payload.channel || 'sms'  // fallback for old tokens
  };
}
```

#### Step 2.2: Update generateAuthUrl to accept channel
**File:** `src/routes/auth.ts` (lines 126-129)

```typescript
export function generateAuthUrl(
  phoneNumber: string,
  channel: 'sms' | 'whatsapp' = 'sms'
): string {
  const state = encryptState(phoneNumber, channel);
  return `${config.server.baseUrl}/auth/google?state=${state}`;
}
```

#### Step 2.3: Update handleAuthError to pass channel from context
**File:** `src/llm/tools/utils.ts` (lines 23-36)

```typescript
export function handleAuthError(
  error: unknown,
  phoneNumber: string,
  channel: 'sms' | 'whatsapp' = 'sms'
): ToolResult {
  if (error instanceof AuthRequiredError) {
    const authUrl = generateAuthUrl(phoneNumber, channel);
    return {
      success: false,
      auth_required: true,
      auth_url: authUrl,
      message: `Please authenticate: ${authUrl}`,
    };
  }
  throw error;
}
```

#### Step 2.4: Update all tool handlers to pass channel
**Files to update:**
- `src/llm/tools/calendar.ts` - `getCalendarEvents`, `createCalendarEvent`, `deleteCalendarEvent`
- `src/llm/tools/email.ts` - `getEmails`, `sendEmail`

**Pattern for each handler:**
```typescript
// Before (example from calendar.ts:53)
return handleAuthError(error, phoneNumber);

// After
return handleAuthError(error, phoneNumber, context.channel ?? 'sms');
```

**Files with handleAuthError calls:**
1. [src/llm/tools/calendar.ts:53](src/llm/tools/calendar.ts#L53) - `getCalendarEvents`
2. [src/llm/tools/calendar.ts:95](src/llm/tools/calendar.ts#L95) - `createCalendarEvent`
3. [src/llm/tools/calendar.ts:129](src/llm/tools/calendar.ts#L129) - `deleteCalendarEvent`
4. [src/llm/tools/email.ts](src/llm/tools/email.ts) - Check for similar patterns

#### Step 2.5: Update continueAfterAuth to use decrypted channel
**File:** `src/routes/auth.ts` (lines 135-177)

```typescript
export async function continueAfterAuth(state: string): Promise<void> {
  const decrypted = decryptState(state);
  if (!decrypted) {
    console.warn('[Auth] Could not decrypt state for continuation');
    return;
  }

  const { phone, channel } = decrypted;
  const cleanPhone = stripPrefix(phone);  // Remove any whatsapp: prefix

  // ... fetch history, build continuation message ...

  const response = await generateResponse(
    continuationMessage,
    history,
    cleanPhone,
    userConfig,
    { channel }  // Use decrypted channel, not inferred
  );

  // Use channel from state, not from phone format
  await sendResponse(cleanPhone, response, channel);
}
```

#### Step 2.6: Ensure sendWhatsApp receives raw phone number
**File:** `src/routes/sms.ts` - Check `sendWhatsApp` function

The `sendWhatsApp` function should add the `whatsapp:` prefix internally:
```typescript
async function sendWhatsApp(to: string, body: string): Promise<void> {
  // Ensure we have raw number, add prefix for Twilio API
  const rawNumber = to.replace(/^whatsapp:/, '');
  await twilioClient.messages.create({
    to: `whatsapp:${rawNumber}`,
    from: `whatsapp:${config.twilio.whatsappNumber}`,
    body,
  });
}
```

**Issue found:** If phone is stored with `whatsapp:` prefix and passed directly, Twilio may receive `whatsapp:whatsapp:+1234567890`. Always strip and re-add.

#### Step 2.7: Tests for channel preservation

```typescript
describe('OAuth Channel Preservation', () => {
  it('preserves SMS channel through OAuth flow', async () => {
    const state = encryptState('+1234567890', 'sms');
    const decrypted = decryptState(state);
    expect(decrypted?.channel).toBe('sms');
  });

  it('preserves WhatsApp channel through OAuth flow', async () => {
    const state = encryptState('+1234567890', 'whatsapp');
    const decrypted = decryptState(state);
    expect(decrypted?.channel).toBe('whatsapp');
  });

  it('handles legacy tokens without channel (defaults to sms)', async () => {
    // Manually craft old-format token
    const legacyState = encryptLegacyState({ phone: '+1234567890', exp: Date.now() + 60000 });
    const decrypted = decryptState(legacyState);
    expect(decrypted?.channel).toBe('sms');
  });
});
```

**Dependencies:** None - can be implemented independently.

---

### 3) Avoid double-injecting continuation message

**Current State:**
- [src/routes/auth.ts:141-152](src/routes/auth.ts#L141-L152) - `continueAfterAuth` builds continuation message
- Need to verify: Is the message added to history AND passed to generateResponse?

**Why This Is Important:**
> Double-injecting the continuation message creates a confusing conversation flow:
> - **The LLM sees duplicate context**, which may cause it to respond twice or reference "I just completed authorization" multiple times
> - **Conversation history becomes polluted** with redundant messages, wasting context window tokens
> - **Debugging becomes harder** because logs show the same message appearing in multiple places
> - **Future message retrieval** may show duplicates to users or in admin tools
>
> This is a **code quality and correctness issue** - it indicates unclear ownership of message lifecycle and can cause subtle bugs as the codebase grows.

**Analysis needed:** Trace the exact flow:
1. `continueAfterAuth` fetches history via `getHistory(cleanPhone)` (line 141)
2. Builds continuation message (line 146)
3. Adds to history? Need to check if `addMessage` is called before `generateResponse`
4. Passes to `generateResponse(continuationMessage, history, ...)` (line 152)

**Implementation Steps:**

#### Step 3.1: Audit current continuation flow
**Check:** Does `continueAfterAuth` call `addMessage()` before `generateResponse()`?

If yes, the continuation message appears twice:
1. In `history` array passed to generateResponse
2. As `userMessage` parameter to generateResponse

**Fix approach:** Choose ONE location:
- **Option A:** Add to history, pass history to generateResponse with empty/null userMessage
- **Option B:** Don't add to history, let generateResponse handle it (preferred - simpler)

#### Step 3.2: Implement fix (Option B - preferred)
**File:** `src/routes/auth.ts` - `continueAfterAuth` function

```typescript
export async function continueAfterAuth(state: string): Promise<void> {
  const { phone, channel } = decryptState(state) ?? {};
  if (!phone) return;

  const cleanPhone = stripPrefix(phone);
  const history = await getHistory(cleanPhone);
  const userConfig = await getUserConfig(cleanPhone);

  // Build continuation message but DON'T add to history
  // generateResponse will handle adding it
  const continuationMessage = "I just completed the authorization. Please continue with my original request.";

  const response = await generateResponse(
    continuationMessage,
    history,  // History WITHOUT the continuation message
    cleanPhone,
    userConfig,
    { channel }
  );

  // DON'T call addMessage here - generateResponse handles it
  await sendResponse(cleanPhone, response, channel);
}
```

#### Step 3.3: Verify generateResponse adds message to history
**File:** `src/llm/index.ts` - Check if `generateResponse` calls `addMessage`

If generateResponse already adds the user message to history internally, we're done.
If not, we may need to add the message AFTER generateResponse returns.

#### Step 3.4: Add test for single message injection

```typescript
describe('OAuth Continuation', () => {
  it('includes continuation message exactly once in conversation', async () => {
    // Setup: Simulate post-auth continuation
    const mockHistory: Message[] = [
      { role: 'user', content: 'Check my calendar' },
      { role: 'assistant', content: 'Please authenticate...' }
    ];

    // Spy on Anthropic API call
    const apiSpy = jest.spyOn(anthropic.messages, 'create');

    await continueAfterAuth(validState);

    // Check the messages sent to API
    const apiCall = apiSpy.mock.calls[0][0];
    const continuationMessages = apiCall.messages.filter(
      m => m.content.includes('completed the authorization')
    );

    expect(continuationMessages).toHaveLength(1);
  });
});
```

**Dependencies:** Should be implemented after #2 (channel preservation) since they touch the same code.

---

### 4) Enforce SMS length limits for TwiML responses

**Current State:**
- [src/routes/sms.ts:191-194](src/routes/sms.ts#L191-L194) - Returns TwiML with `classification.immediateResponse`
- No length checking - could return >160 char message
- WhatsApp supports longer messages (1600+ chars), SMS does not

**Problem:** SMS messages >160 chars get split by carrier, potentially mid-word, or may be truncated.

**Why This Is Important:**
> SMS has hard technical limits that differ from WhatsApp, and ignoring them creates a poor user experience:
> - **Messages over 160 chars are split** by carriers into multiple SMS, often arriving out of order or with awkward breaks mid-word
> - **Some carriers truncate** instead of splitting, so users only see partial responses
> - **Each SMS segment costs money** (~$0.008 per segment), so a 320-char message costs 2x
> - **The sync TwiML response is time-critical** - it must be fast and fit in one message; the async follow-up can be longer
>
> This is a **platform constraint** that must be respected. WhatsApp doesn't have this limit, so the fix must be channel-aware.

**Implementation Steps:**

#### Step 4.1: Create SMS length enforcement helper
**File:** `src/routes/sms.ts` - Add helper function

```typescript
const SMS_MAX_LENGTH = 160;
const TRUNCATION_SUFFIX = '...';

function enforceSmsLength(message: string, channel: 'sms' | 'whatsapp'): string {
  // WhatsApp doesn't need truncation
  if (channel === 'whatsapp') return message;

  if (message.length <= SMS_MAX_LENGTH) return message;

  // Truncate with ellipsis
  const maxContent = SMS_MAX_LENGTH - TRUNCATION_SUFFIX.length;
  return message.slice(0, maxContent) + TRUNCATION_SUFFIX;
}
```

**Alternative approach:** Use a canned acknowledgment for long responses:
```typescript
function enforceSmsLength(message: string, channel: 'sms' | 'whatsapp'): string {
  if (channel === 'whatsapp') return message;
  if (message.length <= SMS_MAX_LENGTH) return message;

  // Use canned ack instead of truncating
  return "Working on your request. I'll send the full response shortly.";
}
```

**Recommendation:** The canned ack is better UX than truncated text.

#### Step 4.2: Apply enforcement in webhook handler
**File:** `src/routes/sms.ts` - Update TwiML response (around line 191)

```typescript
// Get immediate response
let immediateResponse = classification.immediateResponse;

// Enforce SMS length limits (WhatsApp is unaffected)
immediateResponse = enforceSmsLength(immediateResponse, channel);

// Build TwiML
const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(immediateResponse)}</Message>
</Response>`;
```

#### Step 4.3: Consider prompt-level enforcement
**Alternative:** Update classification prompt to explicitly request short responses for SMS.

**File:** `src/llm/prompts.ts` or equivalent

```typescript
// Add to classification system prompt:
`When generating an immediate response:
- For SMS channel: Keep responses under 160 characters
- For WhatsApp channel: Longer responses are acceptable`
```

**Tradeoff:** Prompt-level enforcement is less reliable than code-level truncation. Recommend doing both.

#### Step 4.4: Tests for SMS length enforcement

```typescript
describe('SMS Length Enforcement', () => {
  it('truncates SMS responses over 160 chars', () => {
    const longMessage = 'A'.repeat(200);
    const result = enforceSmsLength(longMessage, 'sms');
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith('...')).toBe(true);
  });

  it('does not truncate WhatsApp responses', () => {
    const longMessage = 'A'.repeat(200);
    const result = enforceSmsLength(longMessage, 'whatsapp');
    expect(result).toBe(longMessage);
  });

  it('does not modify short SMS responses', () => {
    const shortMessage = 'Hello!';
    const result = enforceSmsLength(shortMessage, 'sms');
    expect(result).toBe(shortMessage);
  });
});
```

**Dependencies:** None - can be implemented independently.

---

### 5) Make crypto decode path deterministic

**Current State:**
- [src/routes/auth.ts:80-120](src/routes/auth.ts#L80-L120) - `decryptState()` uses string concat
- [src/services/credentials/sqlite.ts:73-77](src/services/credentials/sqlite.ts#L73-L77) - `decrypt()` uses string concat

**Problem:** String concatenation of `decipher.update() + decipher.final()` may have encoding issues with non-ASCII content or edge cases.

**Why This Is Important:**
> Cryptographic code must be deterministic and handle all byte sequences correctly. The current string concatenation pattern is risky because:
> - **Multi-byte UTF-8 characters can be split** across `update()` and `final()` calls, causing mojibake (garbled text) or decryption failures
> - **Binary data edge cases** may produce invalid strings when concatenated directly
> - **Silent data corruption** is worse than a crash - users may see garbled phone numbers or credentials
> - **OAuth tokens and credentials are sensitive** - any corruption means users must re-authenticate
>
> This is a **correctness and data integrity issue**. While rare in practice (phone numbers are ASCII), the fix is simple and eliminates an entire class of potential bugs. Using `Buffer.concat()` is the canonical Node.js pattern for this.

**Current code pattern (problematic):**
```typescript
const decrypted = decipher.update(encrypted) + decipher.final();
```

**Implementation Steps:**

#### Step 5.1: Fix auth.ts decryptState
**File:** `src/routes/auth.ts` - Update decrypt logic

```typescript
export function decryptState(state: string): { phone: string; channel: 'sms' | 'whatsapp' } | null {
  try {
    const combined = Buffer.from(state, 'base64url');
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = combined.subarray(IV_LENGTH + 16);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Use Buffer.concat for deterministic encoding
    const decryptedBuffer = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    const decrypted = decryptedBuffer.toString('utf8');

    const payload = JSON.parse(decrypted);
    // ... rest unchanged
  } catch (error) {
    console.warn('[Auth] State decryption failed:', error);
    return null;
  }
}
```

#### Step 5.2: Fix credentials/sqlite.ts decrypt
**File:** `src/services/credentials/sqlite.ts` - Update decrypt logic

```typescript
function decrypt(encrypted: Buffer, iv: Buffer, authTag: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Use Buffer.concat for deterministic encoding
  const decryptedBuffer = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);
  return decryptedBuffer.toString('utf8');
}
```

#### Step 5.3: Tests for crypto edge cases

```typescript
describe('Crypto Determinism', () => {
  it('handles non-ASCII characters in decryption', () => {
    const original = { phone: '+1234567890', emoji: '🔐', unicode: 'café' };
    const encrypted = encrypt(JSON.stringify(original));
    const decrypted = JSON.parse(decrypt(encrypted.data, encrypted.iv, encrypted.authTag));
    expect(decrypted).toEqual(original);
  });

  it('handles empty string', () => {
    const encrypted = encrypt('');
    const decrypted = decrypt(encrypted.data, encrypted.iv, encrypted.authTag);
    expect(decrypted).toBe('');
  });

  it('handles large payloads', () => {
    const largeData = 'x'.repeat(10000);
    const encrypted = encrypt(largeData);
    const decrypted = decrypt(encrypted.data, encrypted.iv, encrypted.authTag);
    expect(decrypted).toBe(largeData);
  });

  it('returns null for tampered auth tag', () => {
    const encrypted = encrypt('test');
    const tamperedTag = Buffer.from('0'.repeat(32), 'hex');
    expect(() => decrypt(encrypted.data, encrypted.iv, tamperedTag)).toThrow();
  });
});
```

**Dependencies:** None - can be implemented independently.

---

## Implementation Order & Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: Independent Tasks (can run in parallel)          │
├─────────────────────────────────────────────────────────────┤
│  [1] Twilio Signature Validation  ──────────────────────►   │
│  [4] SMS Length Enforcement       ──────────────────────►   │
│  [5] Crypto Determinism Fix       ──────────────────────►   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: Channel Preservation                              │
├─────────────────────────────────────────────────────────────┤
│  [2] OAuth State + Channel        ──────────────────────►   │
│      - Extend state payload                                 │
│      - Update generateAuthUrl                               │
│      - Update tool handlers                                 │
│      - Fix continueAfterAuth                                │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: Depends on Channel Work                           │
├─────────────────────────────────────────────────────────────┤
│  [3] Double-injection Fix         ──────────────────────►   │
│      - Requires channel flow to be correct first            │
└─────────────────────────────────────────────────────────────┘
```

**Recommended execution:** Start with [1], [4], [5] in parallel, then [2], then [3].

---

## Issues Found During Analysis

### Issue A: IV Length Inconsistency
- **OAuth state:** Uses 12-byte IV ([src/routes/auth.ts:33](src/routes/auth.ts#L33))
- **Credential storage:** Uses 16-byte IV ([src/services/credentials/sqlite.ts:15](src/services/credentials/sqlite.ts#L15))

Both work with AES-256-GCM, but 12 bytes is the recommended IV length per NIST. The 16-byte IV in credentials is non-standard but functional.

**Recommendation:** Standardize on 12-byte IV for new implementations, but don't change existing stored credentials (would break decryption).

### Issue B: State Expiry May Be Too Short
- Current: 10 minutes ([src/routes/auth.ts:35](src/routes/auth.ts#L35))
- OAuth flow with Google can take longer if user needs to select account, review permissions, etc.

**Recommendation:** Consider extending to 15-30 minutes, or making it configurable.

### Issue C: No Encryption Key Rotation
- Same key used forever for both OAuth state and credentials
- Key compromise = all historical data exposed

**Future consideration:** Implement key versioning (store key version with encrypted data).

### Issue D: Missing Rate Limiting
- No rate limiting on `/webhook/sms` endpoint
- Even with signature validation, a compromised Twilio account could flood the system

**Recommendation:** Add rate limiting per phone number (e.g., 10 requests/minute).

---

## Simplification Candidates
- Gate scheduler startup behind a feature flag or environment toggle to avoid DB/poller initialization when scheduling is unused.
- Collapse storage providers to a single local implementation until a second real backend is required (S3/Redis paths appear unused).
- If Phase 1 is still the active target, consider disabling LLM tools/UI routes and running a minimal echo server to reduce attack surface and deployment complexity.

---

## Testing Gaps to Close

| Test | Priority | Status |
|------|----------|--------|
| Twilio signature verification (positive + negative) | Critical | Missing |
| OAuth state roundtrip with channel | High | Missing |
| WhatsApp vs SMS post-auth routing | High | Missing |
| SMS length enforcement (<= 160 chars) | Medium | Missing |
| Crypto decrypt with non-ASCII content | Medium | Missing |
| Crypto decrypt with invalid/tampered data | Medium | Missing |
| Double-injection prevention | Medium | Missing |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/index.ts` | Add raw body capture for webhook routes |
| `src/routes/sms.ts` | Add signature validation, SMS length enforcement |
| `src/routes/auth.ts` | Extend state payload, fix channel handling, fix crypto |
| `src/services/twilio/validation.ts` | **NEW** - Signature validation helper |
| `src/services/credentials/sqlite.ts` | Fix crypto decode pattern |
| `src/llm/tools/utils.ts` | Update `handleAuthError` to accept channel |
| `src/llm/tools/calendar.ts` | Pass channel to `handleAuthError` |
| `src/llm/tools/email.ts` | Pass channel to `handleAuthError` |

---

## Estimated Test Coverage Required

```
tests/
├── twilio-validation.test.ts      # NEW - Signature validation
├── oauth-state.test.ts            # NEW - State encryption with channel
├── sms-length.test.ts             # NEW - Length enforcement
├── crypto-determinism.test.ts     # NEW - Edge cases
└── integration/
    └── post-auth-flow.test.ts     # NEW - End-to-end OAuth continuation
```
