# AGENTS.md

Canonical instructions for AI agents working with this codebase.

## Project Overview

Hermes Assistant is an SMS/WhatsApp personal assistant powered by Anthropic Claude. It uses a multi-agent orchestration pattern to handle requests via Twilio, integrating with Google Workspace (Calendar, Gmail, Drive, Sheets, Docs) and Gemini Vision.

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design.

## Development Environment

**This application must be built and run in WSL (Windows Subsystem for Linux).**

- ngrok tunnel integration requires WSL
- Native binaries (esbuild, rollup) are compiled for Linux
- Production environment (Railway) runs Linux

**If node_modules was installed from Windows:**
```bash
rm -rf node_modules && npm install  # from WSL
```

## Quick Reference

All commands must be run **from WSL**:

```bash
# Development
npm run dev              # Hot reload + ngrok tunnel
npm run dev:server       # Server only (no tunnel)

# Build & Run
npm run build            # Compile TypeScript + copy views
npm start                # Run production build

# Quality
npm test                 # Run all tests (vitest)
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run lint             # ESLint

# Utility
npm run sms              # Send test SMS via script
```

## TypeScript Configuration

- ES modules (`"type": "module"` in package.json)
- Module resolution: `NodeNext`
- Target: ES2022
- Strict mode enabled
- Output: `dist/` directory

## Deployment

**Platform:** Railway

```bash
# Option 1: GitHub integration (auto-deploy on push)
# Option 2: CLI
railway init && railway up
```

Configuration: `railway.toml` (nixpacks builder, /health healthcheck, persistent volume at /app/data)

---

## Architecture at a Glance

```
Twilio SMS/WA → Classifier (fast) → Orchestrator → Agent(s) → Response → SMS back
                                         ↓
                                    Plan → Execute → Replan → Compose
```

### 7 Agents

| Agent | Purpose | Tools |
|-------|---------|-------|
| `calendar-agent` | Google Calendar CRUD | get/create/update/delete events, resolve_date |
| `scheduler-agent` | Reminders and recurring tasks | create/list/update/delete jobs, resolve_date |
| `email-agent` | Gmail search and read | get_emails, read_email, get_email_thread |
| `memory-agent` | Explicit fact management | extract/list/update/remove memory |
| `drive-agent` | Drive, Sheets, Docs, Vision | 16 tools (files, spreadsheets, documents, image analysis) |
| `ui-agent` | Interactive HTML pages | generate_ui (no network access) |
| `general-agent` | Catch-all fallback | all tools |

### 3 Background Processes

| Process | Interval | Purpose |
|---------|----------|---------|
| Scheduler poller | 30 seconds | Execute due reminders/jobs |
| Memory processor | 5 minutes | Extract facts from conversations |
| Stale cleanup | Per memory cycle | Delete old low-confidence observations |

### 3 SQLite Databases

| Database | Tables |
|----------|--------|
| `credentials.db` | credentials, scheduled_jobs, user_config |
| `conversation.db` | conversation_messages, conversation_message_metadata |
| `memory.db` | user_facts |

---

## Coding Guidelines

### Design Principles
- **Avoid over-engineering** — Keep solutions simple and focused on immediate requirements
- **Only implement what's needed** — Don't build features speculatively
- **No premature abstractions** — Three similar lines of code beats one wrong abstraction
- **Prefer explicit over clever** — Code should be immediately understandable
- **Refactor later, not sooner** — Working simple code beats elegant complex code

### TypeScript Practices
- **Strict mode** enabled in tsconfig
- **Prefer `type` over `interface`** unless you need extension/merging
- **Avoid `any`** — Use `unknown` if you truly don't know the type
- **No type assertions unless absolutely necessary** — `as` casts hide type errors

### Code Quality
- **Document why, not what** — Comments explain decisions, not mechanics
- **Single responsibility** — Functions and modules do one thing well
- **Fail fast and loud** — Throw errors early; don't let bad state propagate
- **Keep error handling simple** — Roll up exception categories

### Security
- **Never log sensitive data** — No tokens, credentials, API keys, or full phone numbers
- **Use environment variables** — All secrets via `.env` (never committed)
- **Encrypt tokens at rest** — OAuth tokens encrypted with CREDENTIAL_ENCRYPTION_KEY
- **Validate external input** — Never trust data from Twilio webhooks or user SMS

### Dependencies
- **Minimize dependencies** — Evaluate if you really need a library
- **Prefer standard library** — Use built-in Node.js features when possible

---

## Testing Requirements

**Every code change must include appropriate tests and all tests must pass.**

### What to Test
- Unit tests for major code paths and key branches
- Unit tests for error handling and edge cases
- Integration tests for key workflows
- **Mock external services** — Never call real Twilio, Anthropic, or Google APIs in tests

### Testing Stack
- **Framework**: Vitest
- **HTTP testing**: Supertest
- **Mocking**: Vitest mocks + custom mocks in `tests/mocks/`
- **Config**: `vitest.config.ts` (aliases `@anthropic-ai/sdk` to mock)

### Testing Workflow
1. Write tests alongside code changes
2. Run: `npm run test:unit` and `npm run test:integration`
3. All tests must pass — never skip or disable tests
4. If tests fail, debug and fix until all pass

---

## Development Workflow

### After Making Code Changes

1. Write/update tests for new code paths and error modes
2. Run `npm run test:unit` and `npm run test:integration`
3. Fix failures before proceeding
4. Check if architecture docs need updating

### Architecture Documentation Maintenance

| Document | Update When |
|----------|-------------|
| `ARCHITECTURE.md` | System design changes: new services, request flow, data models, integrations, components |

**Every task list for code changes should include:** "Check if ARCHITECTURE.md needs updating"

### Before Committing

1. Verify tests pass: `npm run test:unit && npm run test:integration`
2. Run linter: `npm run lint`
3. Build to verify: `npm run build`
4. Update architecture docs if applicable

---

## Adding New Agents

To add a new specialized agent:

1. Create `src/agents/<name>/index.ts` — export `capability` and `executor`
2. Create `src/agents/<name>/prompt.ts` — agent system prompt
3. Define tools in `src/tools/<name>.ts` if needed
4. Register tools in `src/tools/index.ts`
5. Import and add to the `AGENTS` array in `src/agents/index.ts` (before general-agent)
6. Write tests in `tests/unit/agents/<name>/`

The agent will automatically be available to the planner and router.

## Adding New Tools

1. Create a `ToolDefinition` in the appropriate `src/tools/*.ts` file
2. Add it to `allTools` array in `src/tools/index.ts`
3. Add the tool name to the relevant agent's tool list in `src/agents/*/index.ts`
4. If it's safe for scheduled execution, add to `READ_ONLY_TOOLS`

---

## Configuration

### Required Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `TWILIO_ACCOUNT_SID` | Twilio account |
| `TWILIO_AUTH_TOKEN` | Twilio authentication |
| `TWILIO_PHONE_NUMBER` | Outbound SMS number |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `CREDENTIAL_ENCRYPTION_KEY` | 64-char hex string for encrypting OAuth tokens |

### Optional Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | HTTP server port |
| `NODE_ENV` | development | Runtime environment |
| `BASE_URL` | http://localhost:3000 | For generating short links |
| `GOOGLE_REDIRECT_URI` | http://localhost:3000/auth/google/callback | OAuth redirect |
| `GEMINI_API_KEY` | — | Gemini Vision API |
| `GEMINI_MODEL` | gemini-2.5-flash | Vision model |
| `MEMORY_INJECTION_THRESHOLD` | 0.5 | Min confidence for fact injection |
| `MEMORY_PROCESSOR_INTERVAL_MS` | 300000 | Background extraction interval |
| `MEMORY_PROCESSOR_BATCH_SIZE` | 100 | Max messages per extraction run |
| `MEMORY_PROCESSOR_PER_USER_BATCH_SIZE` | 25 | Max messages per user per run |
| `MEMORY_MODEL_ID` | claude-opus-4-5-20251101 | Model for memory extraction |
| `UI_STORAGE_PROVIDER` | local | UI page storage (local or s3) |
| `PAGE_TTL_DAYS` | 7 | UI page expiry |

---

## Git Workflow

### Commit Messages

Include issue ID in parentheses when applicable:
```bash
git commit -m "Fix auth validation bug (hermes-assistant-abc)"
```

### Beads Integration

This project uses [beads](https://github.com/steveyegge/beads) for issue tracking:
```bash
bd list              # List issues
bd ready             # Show issues ready to work
bd create "Title"    # Create issue
bd close <id>        # Close issue
bd sync              # Sync with git remote
```

### Session Close Protocol

```bash
git status              # Check what changed
git add <files>         # Stage code changes
bd sync                 # Commit beads changes
git commit -m "..."     # Commit code
bd sync                 # Commit any new beads changes
git push                # Push to remote
```

---

## Claude Code Tool Usage

When using Claude Code specifically:
- **Use TodoWrite** for multi-step tasks to track progress
- **Prefer Edit over Write** for modifying existing files
- **Use Task tool with Explore agent** for codebase searches
- **Use Task tool with Plan agent** for designing implementation approaches
