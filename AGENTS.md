# AGENTS.md

This file provides guidance for AI agents working with this codebase. It is the canonical source of project rules and conventions.

## Project Overview

This is an SMS-based personal assistant that communicates via Twilio and is powered by Anthropic's Claude LLM with MCP (Model Context Protocol) tool integrations. The assistant accesses Google services (Gmail, Calendar) and runs as a persistent service deployable to Railway or other cloud platforms.

## Quick Reference

```bash
# Development
npm run dev              # Hot reload + ngrok tunnel
npm run dev:server       # Server only

# Build & Run
npm run build            # Compile TypeScript
npm start                # Run production build

# Quality
npm test                 # Run tests
npm run lint             # Lint code
```

## TypeScript Configuration

- ES modules (`"type": "module"` in package.json)
- Module resolution: `NodeNext`
- Target: ES2022
- Strict mode enabled
- Output: `dist/` directory

## Deployment

**Target platform:** Railway

**Option 1 - GitHub integration:**
- Connect GitHub repo to Railway (auto-deploy on push)

**Option 2 - CLI:**
```bash
railway init && railway up
```

Configuration is in `railway.toml`.

## Claude Code Tool Usage

When using Claude Code specifically:
- **Use TodoWrite** for multi-step tasks to track progress
- **Prefer Edit over Write** for modifying existing files
- **Use Task tool with Explore agent** for codebase searches and questions
- **Use Task tool with Plan agent** for designing implementation approaches

## Architecture

The project follows a phased implementation approach:

### Phase 1: SMS Echo MVP ✓ Complete
- Express server with webhook endpoint (`POST /webhook/sms`)
- Receives SMS from Twilio, returns TwiML response
- No LLM, no MCP tools - just proves the SMS pipeline works
- Deployed to Railway for 24/7 availability

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

### File Organization

```
hermes-assistant/
├── src/
│   ├── index.ts          # Express server entry point
│   ├── config.ts         # Environment configuration
│   └── routes/
│       └── sms.ts        # SMS webhook handler
├── dist/                 # Compiled output
├── docs/                 # Requirements and specifications
└── *.md                  # Documentation
```

## Configuration

Environment variables are defined in `.env.example`. Key variables:
- Twilio credentials (account SID, auth token, phone numbers)
- Anthropic API key
- Google OAuth credentials
- Server configuration (port, base URL)

## Important Constraints

- **SMS Delivery**: Response must be sent via TwiML in webhook response (< 160 chars per SMS)
- **Security**: All OAuth tokens must be encrypted at rest
- **Authentication**: Phone number verification for user authentication
- **Rate Limiting**: Consider Twilio and Google API limits
- **Cost Management**: Twilio charges per SMS (~$0.016/round-trip)

---

## Coding Guidelines

### Design Principles
- **Avoid over-engineering** - Keep solutions simple and focused on immediate requirements
- **Only implement what's needed** - Don't build Phase 2 features while working on Phase 1
- **No premature abstractions** - Three instances of similar code is better than one wrong abstraction
- **Prefer explicit over clever** - Code should be immediately understandable
- **Refactor later, not sooner** - Working simple code beats elegant complex code
- **Don't design for hypothetical future requirements**

### Code Quality
- **Document why, not what** - Comments should explain decisions and context
- **Single responsibility** - Functions and modules should do one thing well
- **Fail fast and loud** - Throw errors early; don't let bad state propagate
- **Keep error handling simple** - Roll up exception categories (e.g., "Twilio failed" instead of granular error types)

### TypeScript Practices
- **Use strict mode** (already enabled in tsconfig)
- **Prefer `type` over `interface`** unless you need extension/merging
- **Avoid `any`** - Use `unknown` if you truly don't know the type
- **No type assertions unless absolutely necessary** - `as` casts hide type errors

### Dependencies
- **Minimize dependencies** - Evaluate if you really need a library
- **Prefer standard library** - Use built-in Node.js features when possible
- **Vet security** - Check npm audit and consider maintenance status

### Security
- **Never log sensitive data** - No tokens, credentials, API keys, or full phone numbers
- **Use environment variables** - All secrets via `.env` (never committed)
- **Encrypt tokens at rest** - When storage is added, encrypt OAuth tokens
- **Validate external input** - Never trust data from Twilio webhooks or user SMS

### Testing Requirements

**MANDATORY:** Every code change must include appropriate tests and all tests must pass.

#### What to Test
- **Unit tests for major code paths** - Test the main functionality and key branches
- **Unit tests for major error modes** - Test error handling, edge cases, and failure scenarios
- **Integration tests for key workflows** - Test end-to-end behavior of important features
- **Mock external services** - Never call real Twilio, Anthropic, or Google APIs in tests

#### Testing Workflow
1. **Write tests alongside code changes** - New features and bug fixes require new tests
2. **Run unit and integration tests after every change**: `npm run test:unit` and `npm run test:integration`
3. **All tests must pass** - Never consider work complete with failing tests
4. **If tests fail, keep working** - Debug and fix until all tests pass
5. **Don't skip or disable tests** - Fix the code or the test, never skip

#### Test Quality
- Tests should be readable and document expected behavior
- Each test should verify one specific behavior
- Use descriptive test names that explain what's being tested
- Prefer explicit assertions over clever test abstractions

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

---

## Development Workflow

### After Making Code Changes

**CRITICAL:** All code changes require tests and verification.

1. **Write/update tests** - Add unit and integration tests for new code paths and error modes
2. **Run unit and integration tests**: `npm run test:unit` and `npm run test:integration`
3. **If tests fail** - Debug, fix, and re-run until all pass. Do not proceed with failing tests.
4. **Repeat** - Continue iterating until all tests pass

### Architecture Documentation Maintenance

**MANDATORY:** When making code changes, always include a task to check if architecture documentation needs updating.

| Document | Update When |
|----------|-------------|
| `MEMORY.md` | Any change to memory system: storage, extraction, prompts, context injection, processor, or memory agent |
| `ARCHITECTURE.md` | Any change to system design: new services, request flow, data models, external integrations, or component interactions |

**Task List Requirement:** Every task list for code changes MUST include:
- "Check if MEMORY.md needs updating" (for memory-related changes)
- "Check if ARCHITECTURE.md needs updating" (for architecture-related changes)

These documents are the source of truth for understanding the system. Outdated documentation causes confusion and bugs.

### Before Committing

1. **Verify unit and integration tests pass**: `npm run test:unit` and `npm run test:integration` (run again to confirm)
2. **Run linter**: `npm run lint`
3. **Build to verify**: `npm run build`
4. **Update architecture docs**: If you changed memory or system architecture, update `MEMORY.md` or `ARCHITECTURE.md`
5. **Update other docs**: If you changed behavior, update relevant docs

### Testing

**IMPORTANT:** Never pollute production with test data!

```bash
# Run all tests
npm test

# For manual testing with dev server
npm run dev
```

**Always mock external services** (Twilio, Anthropic, Google) in tests.

### Common Development Tasks

#### Adding a New Endpoint

1. Create handler in `src/routes/` or appropriate feature directory
2. Register route in `src/index.ts`
3. Add types if needed
4. **Write unit tests** for handler logic (success and error cases)
5. **Write integration tests** for the endpoint
6. **Run `npm test`** and fix any failures
7. Document if public API

#### Adding Storage Features (Phase 2+)

1. Update schema/types
2. Add migration if using SQLite
3. Implement storage logic
4. **Write unit tests** for storage operations
5. **Write integration tests** for data flows
6. **Run `npm test`** and fix any failures

---

## Git Workflow

### Commit Message Convention

Include issue ID in parentheses when applicable:

```bash
git commit -m "Fix auth validation bug (hermes-assistant-abc)"
```

### Beads Integration

This project uses [beads](https://github.com/steveyegge/beads) for issue tracking.

**Common commands:**
```bash
bd list              # List issues
bd ready             # Show issues ready to work
bd create "Title"    # Create issue
bd close <id>        # Close issue
bd sync              # Sync with git remote
```

**Auto-sync provides batching** - bd automatically exports to JSONL after CRUD operations (30-second debounce).

**At end of session**, always run:
```bash
bd sync
```

This immediately exports, commits, and pushes issue changes.

### Session Close Protocol

Before ending a session, complete this checklist:

```bash
[ ] git status              # Check what changed
[ ] git add <files>         # Stage code changes
[ ] bd sync                 # Commit beads changes
[ ] git commit -m "..."     # Commit code
[ ] bd sync                 # Commit any new beads changes
[ ] git push                # Push to remote
```

Work is not done until pushed.

---

## Phase 1 Checklist ✓

- [x] Express server with `/webhook/sms` endpoint
- [x] Health check endpoint (`GET /health`)
- [x] Parse Twilio webhook body (From, To, Body)
- [x] Return TwiML response with echo message
- [x] Deploy to Railway
- [x] Configure Twilio webhook URL

---

## Documentation

- `AGENTS.md` - This file (canonical agent instructions, including Claude Code usage)
- `ARCHITECTURE.md` - System design, request flow, timezone handling
- `README.md` - Quick start and project overview
- `docs/` - Feature specs and implementation plans
