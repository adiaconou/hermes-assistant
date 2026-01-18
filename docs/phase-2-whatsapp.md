# Phase 2: WhatsApp Integration

## Goal

Extend the Phase 1 SMS webhook to also receive and respond to WhatsApp messages via Twilio.

**Same webhook, same TwiML response format.** The only difference is the `From` field format (`whatsapp:+1234567890` vs `+1234567890`).

---

## Implementation Philosophy

This is a **personal assistant for one user**. Build the minimum viable implementation first, then layer on complexity only when problems arise.

### MVP First
- Get it working with the simplest possible code
- Hardcoded response is fine (LLM comes in Phase 3)
- Console.log is fine for debugging
- In-memory state is fine for single user

### Add Complexity When Needed
| Feature | Add When... |
|---------|-------------|
| Twilio signature validation | Security concern arises |
| Structured JSON logging | Debugging becomes painful |
| Rate limiting | Abuse becomes an issue (unlikely for personal use) |
| Idempotency | Twilio retries cause duplicate problems |
| Middleware pipeline | Inline code gets too complex |
| LRU caches | Memory issues arise (unlikely for single user) |

### YAGNI for Personal Use
The following are documented in [Phase 2.2](#phase-22-production-hardening-future) but **not needed** for a personal assistant:
- Token bucket rate limiting
- AbortController/signal propagation
- 8-layer middleware pipeline
- LRU+TTL caches with size caps
- Global/IP-based rate limiting

---

## Phase 2.1: WhatsApp MVP

### Success Criteria

```
1. Send a WhatsApp message to your Twilio number
2. Receive a hardcoded response within 5 seconds
3. Server logs show the message was received
4. Both SMS and WhatsApp work through the same endpoint
```

### Scope

**In Scope**:
- [x] Detect WhatsApp vs SMS from `From` field prefix
- [x] Return TwiML response for both channels
- [x] Health check endpoint (`GET /health`)
- [x] Configure Twilio WhatsApp webhook

**Out of Scope (Phase 2.2+)**:
- Twilio signature validation
- Idempotency
- Rate limiting
- Structured logging
- Middleware pipeline

### Technical Implementation

#### Webhook Handler (Simple Version)

```typescript
// src/routes/sms.ts
import { Router, Request, Response } from 'express';
import twilio from 'twilio';

const router = Router();

type MessageChannel = 'whatsapp' | 'sms';

function detectChannel(from: string): MessageChannel {
  return from.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
}

function stripPrefix(address: string): string {
  return address.replace('whatsapp:', '');
}

router.post('/webhook/sms', (req: Request, res: Response) => {
  const { From, To, Body, MessageSid } = req.body;

  const channel = detectChannel(From);
  const sender = stripPrefix(From);

  console.log(`[${channel}] ${sender}: ${Body}`);

  // Hardcoded response for now (LLM comes in Phase 3)
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(`Got your ${channel} message: "${Body}"`);

  res.type('text/xml').send(twiml.toString());
});

export default router;
```

#### Health Endpoint

```typescript
// In src/index.ts
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

That's it. ~30 lines of code for the MVP.

### Setup Steps

#### 1. Twilio WhatsApp Configuration

**Option A: WhatsApp Sandbox (for testing)**
1. Go to Twilio Console → Messaging → Try it out → Send a WhatsApp message
2. Join sandbox by sending "join <sandbox-word>" to +1 415 523 8886
3. Set webhook URL: `https://your-app.railway.app/webhook/sms`

**Option B: Your Twilio Number with WhatsApp (production)**
1. Enable WhatsApp on your Twilio phone number (requires WhatsApp Business approval)
2. Configure the same webhook URL: `https://your-app.railway.app/webhook/sms`

#### 2. Local Development

```bash
npm run dev

# In another terminal:
ngrok http 3000
# or
cloudflared tunnel --url http://localhost:3000
```

Configure Twilio webhook to your tunnel URL.

#### 3. Deploy to Railway

Same as Phase 1 - the webhook endpoint is unchanged.

### Testing Checklist

- [ ] Send SMS → receive response
- [ ] Send WhatsApp → receive response
- [ ] Health endpoint responds at `/health`
- [ ] Server logs show channel type and message

---

## Phase 2.2: Production Hardening (Future)

These features are documented for when/if you need them. **Skip for personal use.**

### Twilio Signature Validation

Validate that requests actually come from Twilio:

```typescript
import twilio from 'twilio';

function validateTwilioSignature(req: Request): boolean {
  const signature = req.header('X-Twilio-Signature') || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';

  // Reconstruct URL from forwarded headers (for proxies like Railway)
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  const url = `${proto}://${host}${req.originalUrl}`;

  return twilio.validateRequest(authToken, signature, url, req.body);
}

// In handler:
if (!validateTwilioSignature(req)) {
  console.warn('Invalid Twilio signature');
  return res.status(403).send('Forbidden');
}
```

**When to add**: When deploying to public internet and security is a concern.

### Idempotency

Prevent duplicate processing of the same message:

```typescript
const seenMessages = new Map<string, { twiml: string; seenAt: number }>();
const SEEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getOrSetResponse(messageSid: string, generateResponse: () => string): string {
  const existing = seenMessages.get(messageSid);
  if (existing && Date.now() - existing.seenAt < SEEN_TTL_MS) {
    console.log(`Replaying response for ${messageSid}`);
    return existing.twiml;
  }

  const twiml = generateResponse();
  seenMessages.set(messageSid, { twiml, seenAt: Date.now() });
  return twiml;
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [sid, entry] of seenMessages) {
    if (now - entry.seenAt > SEEN_TTL_MS) {
      seenMessages.delete(sid);
    }
  }
}, 60_000);
```

**When to add**: When Twilio retries cause duplicate processing issues.

### Rate Limiting

Simple per-sender rate limiting:

```typescript
const rateLimits = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 30;

function isRateLimited(sender: string): boolean {
  const now = Date.now();
  const timestamps = rateLimits.get(sender) || [];

  // Remove old timestamps
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimits.set(sender, recent);

  return recent.length > RATE_LIMIT_MAX;
}
```

**When to add**: When abuse becomes an issue (unlikely for personal use).

### Structured Logging

Replace console.log with structured JSON:

```typescript
function log(level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

// Usage:
log('info', 'incoming_message', {
  channel: 'whatsapp',
  messageSid: 'SM123...',
  bodyLength: 42,
});
```

**When to add**: When debugging production issues becomes painful.

### Response Timeout Budget

Ensure response within Twilio's timeout:

```typescript
const RESPONSE_DEADLINE_MS = 4500; // Leave 500ms buffer

const deadline = new Promise<string>((resolve) =>
  setTimeout(() => resolve(makeFallbackTwiML()), RESPONSE_DEADLINE_MS)
);

const work = processMessage(ctx); // Returns Promise<string>

const twiml = await Promise.race([work, deadline]);
res.type('text/xml').send(twiml);
```

**When to add**: When LLM integration (Phase 3) makes responses slow.

### Full Middleware Pipeline

For complex production deployments, structure as composable middleware:

```
POST /webhook/sms
1) requestContext()        → attach requestId, startTime
2) enforceConstraints()    → POST + content-type + body size
3) validateTwilioSignature()
4) normalizeMessage()      → build MessageContext
5) idempotencyReplay()     → check if seen, replay if so
6) rateLimit()             → per-sender + global
7) deadlineGuard()         → race work vs deadline
8) handler()               → business logic
```

**When to add**: When the inline handler gets too complex to maintain.

---

## Reference

### Twilio Webhook Format

Twilio sends the same format for SMS and WhatsApp:

```
POST /webhook/sms
Content-Type: application/x-www-form-urlencoded

MessageSid=SM123...
From=whatsapp:+1234567890  (or +1234567890 for SMS)
To=whatsapp:+14155238886   (or +1987654321 for SMS)
Body=Hello assistant!
```

### Environment Variables

```bash
# Required
PORT=3000
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1xxx

# Optional (for signature validation)
PUBLIC_BASE_URL=https://your-app.railway.app
```

### WhatsApp Sandbox Limitations

| Limitation | Impact |
|------------|--------|
| Must rejoin every 72 hours if inactive | Re-send join message |
| Only joined numbers can message | Fine for personal use |
| No proactive messaging | Can only reply to incoming |
| Shared sandbox number | Not your own number |

For production, upgrade to WhatsApp Business API (requires Meta approval).

### Cost Estimate

| Item | Cost |
|------|------|
| WhatsApp Sandbox | Free |
| WhatsApp Business API (future) | ~$0.005-0.05/message |
| Railway | Same as Phase 1 |

WhatsApp is often cheaper than SMS, especially internationally.

---

## Phase 2 → Phase 3 Transition

Phase 2 proves WhatsApp works through the same webhook.

Phase 3 adds:
- Claude LLM integration
- Dynamic responses based on user message
- Conversation context

The webhook structure stays the same - we just replace the hardcoded response with an LLM call.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 5.0 | 2026-01-15 | Reorganized for MVP-first approach. Moved production hardening to Phase 2.2 |
| 4.0 | 2026-01-14 | Full production spec (now in Phase 2.2) |
| 1.0 | 2026-01-13 | Initial Phase 2 spec |
