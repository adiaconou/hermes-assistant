# Phase 1: SMS Echo MVP

## Goal

Prove end-to-end SMS integration works: send a text → receive a response.

**No LLM. No MCP. No intelligence.** Just a hardcoded reply to prove the pipeline is functional.

---

## Success Criteria

```
1. I text my assistant's Twilio number
2. I receive a response within 5 seconds
3. The service is deployed to Railway and always available
```

---

## Scope

### In Scope
- [x] Twilio account setup with phone number
- [ ] Express server with SMS webhook endpoint
- [ ] Send hardcoded reply via Twilio API
- [ ] Deploy to Railway
- [ ] Environment variable configuration

### Out of Scope (Future Phases)
- LLM integration
- MCP tools
- Google OAuth
- Database/storage
- Conversation history
- Automation/events

---

## Architecture

```
┌──────────────┐     SMS      ┌──────────────┐
│              │ ──────────►  │              │
│  Your Phone  │              │    Twilio    │
│              │ ◄──────────  │              │
└──────────────┘     SMS      └──────────────┘
                                     │
                              Webhook │ POST /webhook/sms
                                     ▼
                              ┌──────────────┐
                              │   Railway    │
                              │  (Express)   │
                              │              │
                              │ Returns TwiML│
                              │  response    │
                              └──────────────┘
```

---

## Technical Implementation

### 1. Project Setup

```
src/
├── index.ts          # Express server entry point
├── routes/
│   └── sms.ts        # SMS webhook handler
└── config.ts         # Environment config
```

### 2. Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "twilio": "^5.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "typescript": "^5.7.0",
    "tsx": "^4.0.0"
  }
}
```

### 3. SMS Webhook Endpoint

```typescript
// POST /webhook/sms
// Receives: From, To, Body (from Twilio)
// Returns: TwiML with <Message> response

app.post('/webhook/sms', (req, res) => {
  const { From, Body } = req.body;

  console.log(`Received SMS from ${From}: ${Body}`);

  // Hardcoded response - no intelligence yet
  const response = `👋 I received your message: "${Body}"`;

  res.type('text/xml');
  res.send(`
    <?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Message>${response}</Message>
    </Response>
  `);
});
```

### 4. Environment Variables

```bash
# .env
PORT=3000
TWILIO_ACCOUNT_SID=xxx      # For future outbound SMS
TWILIO_AUTH_TOKEN=xxx       # For future outbound SMS
TWILIO_PHONE_NUMBER=+1xxx   # For logging/reference
```

> Note: For Phase 1, we only need the webhook. Twilio handles sending the reply based on our TwiML response. We don't need the Twilio SDK yet.

---

## Setup Steps

### 1. Twilio Setup
1. Create Twilio account (https://twilio.com)
2. Get a phone number (~$1.15/month + ~$0.0079/SMS)
3. Note your Account SID and Auth Token

### 2. Local Development
```bash
# Install dependencies
npm install

# Run locally
npm run dev

# In another terminal, start tunnel
ngrok http 3000
# or
cloudflared tunnel --url http://localhost:3000
```

### 3. Configure Twilio Webhook
1. Go to Twilio Console → Phone Numbers → Your Number
2. Under "Messaging", set webhook URL:
   - Local: `https://your-ngrok-url.ngrok.io/webhook/sms`
   - Production: `https://your-app.railway.app/webhook/sms`
3. Method: HTTP POST

### 4. Deploy to Railway
```bash
# Option A: Connect GitHub repo
# Railway auto-deploys on push

# Option B: Railway CLI
npm install -g @railway/cli
railway login
railway init
railway up
```

### 5. Update Twilio Webhook
- Change webhook URL to Railway URL

---

## Testing Checklist

- [ ] Local: Send SMS → receive hardcoded response
- [ ] Local: Check server logs show received message
- [ ] Railway: Deploy succeeds
- [ ] Railway: Health check endpoint responds (`GET /health`)
- [ ] Production: Send SMS → receive response from Railway deployment

---

## API Reference

### POST /webhook/sms

Twilio sends:
```
Content-Type: application/x-www-form-urlencoded

MessageSid=SM123...
From=+1234567890
To=+0987654321
Body=Hello assistant!
```

We respond with TwiML:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>👋 I received your message: "Hello assistant!"</Message>
</Response>
```

### GET /health

Health check for Railway:
```json
{ "status": "ok", "timestamp": "2025-01-11T..." }
```

---

## Cost Estimate

| Item | Cost |
|------|------|
| Twilio phone number | ~$1.15/month |
| Twilio SMS (send + receive) | ~$0.016/round-trip |
| Railway | $5/month (Pro) or free tier |
| **Total** | ~$6-7/month |

---

## Phase 1 → Phase 2 Transition

Once Phase 1 is working, Phase 2 adds:
- Anthropic Claude integration
- Dynamic responses based on LLM
- Basic conversation (still no tools)

The webhook structure stays the same - we just replace the hardcoded response with an LLM call.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-11 | Initial Phase 1 spec |
