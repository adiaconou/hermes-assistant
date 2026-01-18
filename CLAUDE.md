# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an SMS-based personal assistant that communicates via Twilio and is powered by Anthropic's Claude LLM with MCP (Model Context Protocol) tool integrations. The assistant accesses Google services (Gmail, Calendar) and runs as a persistent service deployable to Railway or other cloud platforms.

## Development Commands

```bash
# Development (with hot reload)
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start

# Run tests
npm test

# Lint
npm run lint
```

## Architecture

The project follows a phased implementation approach:

### Phase 1: SMS Echo MVP ✓ Complete
- Express server with webhook endpoint (`POST /webhook/sms`)
- Receives SMS from Twilio, returns hardcoded TwiML response
- No LLM, no MCP tools yet - just proves the SMS pipeline works
- Deploys to Railway for 24/7 availability

### Phase 2+: Full Assistant (Future)
- LLM integration via Anthropic Claude API
- MCP tool framework for extensible capabilities
- Google OAuth flow (SMS-friendly with auth links)
- Event-driven automation (email/calendar watchers, reminders, daily briefings)
- Automation rules engine with quiet hours support
- Persistent storage (SQLite for tasks, rules, tokens)

### Key Components (Future)
- **Message Router**: Routes inbound SMS to handler, outbound notifications to Twilio
- **Message Handler**: Processes SMS requests with LLM
- **Scheduler**: Cron-like job scheduling for reminders and periodic tasks
- **Event Listener**: Polls/webhooks for external events (Gmail, Calendar)
- **Automation Rules**: User-defined trigger → action rules
- **Auth Manager**: Handles OAuth flows via SMS-sent links

## Configuration

Environment variables are defined in `.env.example`. Key variables:
- Twilio credentials (account SID, auth token, phone numbers)
- Anthropic API key
- Google OAuth credentials
- Server configuration (port, base URL)

## Development Notes

### TypeScript Configuration
- Uses ES modules (`"type": "module"` in package.json)
- Module resolution: `NodeNext`
- Target: ES2022
- Strict mode enabled
- Output: `dist/` directory

### Deployment
Railway is the target platform. Two deployment methods:
1. Connect GitHub repo (auto-deploy on push)
2. Railway CLI: `railway init && railway up`

Update Twilio webhook URL to Railway domain after deployment.

## Documentation

- `AGENTS.md` - **Agent workflow instructions** (issue tracking, git workflow, testing, landing the plane)
- `docs/requirements.md` - Full product requirements (all phases)
- `docs/phase-1-requirements.md` - Phase 1 MVP specification
- `README.md` - Quick start and project overview

## Important Constraints

- **SMS Delivery**: Response must be sent via TwiML in webhook response (< 160 chars per SMS)
- **Security**: All OAuth tokens must be encrypted at rest
- **Authentication**: Phone number verification for user authentication
- **Rate Limiting**: Consider Twilio and Google API limits
- **Cost Management**: Twilio charges per SMS (~$0.016/round-trip)

## Coding Guidelines

### Simplicity & YAGNI
- **Only implement what's needed for the current phase** - Don't build Phase 2 features while working on Phase 1
- **No premature abstractions** - Three instances of similar code is better than one wrong abstraction
- **Prefer explicit over clever** - Code should be immediately understandable by someone reading it for the first time
- **Refactor later, not sooner** - Working simple code beats elegant complex code every time

### Code Quality
- **Document why, not what** - Comments should explain decisions and context, not restate obvious code
- **Single responsibility** - Functions and modules should do one thing well
- **Fail fast and loud** - Throw errors early; don't let bad state propagate
- **Keep error handling simple** - Don't create custom error classes or granular categorization unless there's a clear need to handle specific error types differently. Roll up exception categories. For example, "Twilio failed" is often sufficient instead of separate handling for network errors, auth errors, rate limits, etc.

### TypeScript Practices
- **Use strict mode** (already enabled in tsconfig)
- **Prefer `type` over `interface`** unless you need extension/merging
- **Avoid `any`** - Use `unknown` if you truly don't know the type
- **No type assertions unless absolutely necessary** - `as` casts hide type errors

### Dependencies
- **Minimize dependencies** - Evaluate if you really need a library before adding it
- **Prefer standard library** - Use built-in Node.js features when possible
- **Vet security** - Check npm audit and consider maintenance status

### Security
- **Never log sensitive data** - No tokens, credentials, API keys, or full phone numbers in logs
- **Use environment variables** - All secrets and config via `.env` (never committed)
- **Encrypt tokens at rest** - When Phase 2+ adds storage, encrypt OAuth tokens
- **Validate external input** - Never trust data from Twilio webhooks or user SMS

### Testing Strategy
- **Integration tests for webhooks** - Test the full request → response flow
- **Unit tests for business logic** - Test pure functions in isolation
- **Don't test external services** - Mock Twilio, Anthropic, Google APIs
- **Test error paths** - Verify behavior when external services fail

### Logging
- **Structured logging** - Use JSON format for production logs
- **Include context** - Request IDs, user identifiers (hashed phone numbers)
- **Log errors with stack traces** - But sanitize sensitive data first
- **Different levels** - Debug (development), Info (production), Error (always)

### Code Organization
- **Flat structure initially** - Don't create deep hierarchies until complexity demands it
- **Group by feature, not type** - `sms/` instead of `controllers/`, `services/`, `models/`
- **Configuration in one place** - Centralize env var loading and validation
- **Keep routes thin** - Handlers should delegate to business logic functions

## Phase 1 Checklist ✓

- [x] Express server with `/webhook/sms` endpoint
- [x] Health check endpoint (`GET /health`)
- [x] Parse Twilio webhook body (From, To, Body)
- [x] Return TwiML response with echo message
- [x] Deploy to Railway
- [x] Configure Twilio webhook URL
