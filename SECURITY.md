# Security

Security practices, credential management, and input validation for Hermes Assistant.

---

## Credential Management

### OAuth Tokens

- All OAuth tokens are encrypted at rest using **AES-256-GCM**
- Encryption key: `CREDENTIAL_ENCRYPTION_KEY` (64-char hex string, required env var)
- Stored in `credentials.db` as encrypted BLOB with separate IV and auth tag columns
- Tokens are decrypted only at the moment of API call, never cached in plaintext

### Secrets

- All secrets stored as environment variables via `.env` (never committed to git)
- `.env` is in `.gitignore`
- Railway deployment uses encrypted environment variables

### Known Gaps

- No key rotation mechanism (see [tech-debt-tracker](tech-debt-tracker.md), T-30)
- Admin routes lack authentication (T-D1) — local/trusted use only

---

## Input Validation

### Twilio Webhooks

- **Signature validation**: Currently missing (T-02) — unauthenticated webhook is a cost and security risk
- All webhook payload fields should be treated as untrusted external input
- Phone numbers are used as user identity — no additional authentication layer

### User SMS Content

- User message content is passed directly to the LLM classifier and orchestrator
- No explicit sanitization beyond what Claude provides as an LLM safety layer
- Tool handlers validate their own inputs (e.g., date resolution, skill names)

---

## Logging Policy

- **Never log**: OAuth tokens, API keys, `CREDENTIAL_ENCRYPTION_KEY`, full phone numbers, email content
- **Safe to log**: Last 4 digits of phone numbers, request IDs, tool names, agent names, timing data
- Trace logger (`src/utils/trace-logger.ts`) handles structured logging with phone number masking

---

## Content Security Policy

Generated UI pages are served with CSP headers:
- No external script sources
- No external style sources
- Inline scripts and styles allowed (pages are self-contained)
- No form submissions to external URLs

---

## Environment Variables

### Sensitive (Never Log)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `TWILIO_AUTH_TOKEN` | Twilio webhook signature validation |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256-GCM encryption key |
| `GEMINI_API_KEY` | Gemini Vision API |

### Not Sensitive

| Variable | Purpose |
|----------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio account identifier (public) |
| `TWILIO_PHONE_NUMBER` | Outbound SMS number |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (public) |
| `PORT`, `NODE_ENV`, `BASE_URL` | Runtime configuration |
