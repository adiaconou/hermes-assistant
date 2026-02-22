# AGENTS.md

Canonical instructions for AI agents working with this codebase.

## Project Overview

Hermes Assistant is an SMS/WhatsApp personal assistant powered by Anthropic Claude. It uses a multi-agent orchestration pattern to handle requests via Twilio, integrating with Google Workspace (Calendar, Gmail, Drive, Sheets, Docs) and Gemini Vision.

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design. See [docs/archive/design-docs/core-beliefs.md](docs/archive/design-docs/core-beliefs.md) for non-negotiable constraints.

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

## Documentation Map

| Topic | Source of Truth |
|-------|----------------|
| High-level architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Core beliefs & constraints | [docs/archive/design-docs/core-beliefs.md](docs/archive/design-docs/core-beliefs.md) |
| Design docs catalog | [docs/archive/design-docs/index.md](docs/archive/design-docs/index.md) |
| Product specs | [docs/archive/product-specs/index.md](docs/archive/product-specs/index.md) |
| Design patterns & coding standards | [DESIGN.md](DESIGN.md) |
| Testing & quality | [QUALITY_SCORE.md](QUALITY_SCORE.md) |
| Security | [SECURITY.md](SECURITY.md) |
| Reliability | [RELIABILITY.md](RELIABILITY.md) |
| Frontend & UI | [FRONTEND.md](FRONTEND.md) |
| Product sense | [PRODUCT_SENSE.md](PRODUCT_SENSE.md) |
| ExecPlan methodology | [PLANS.md](PLANS.md) |
| Active exec plans | [docs/exec-plans/active/](docs/exec-plans/active/) |
| Completed exec plans | [docs/exec-plans/completed/](docs/exec-plans/completed/) |
| Tech debt | [tech-debt-tracker.md](tech-debt-tracker.md) |
| Database schemas | [docs/archive/generated/db-schema.md](docs/archive/generated/db-schema.md) |

### When to Read What

Not every doc needs to be in context for every task. Use this guide:

**Always loaded** (via CLAUDE.md → AGENTS.md): This file. It's the entry point for all work.

**Read before any task:**
- [core-beliefs.md](docs/archive/design-docs/core-beliefs.md) — Agent-first operating principles. The tiebreaker when two reasonable approaches conflict.

**Read based on what you're changing:**
- [ARCHITECTURE.md](ARCHITECTURE.md) — When adding or modifying a system component, or when you need to understand how parts connect.
- [DESIGN.md](DESIGN.md) — When writing new code. Contains patterns, coding standards, and TypeScript practices.
- [QUALITY_SCORE.md](QUALITY_SCORE.md) — When writing tests or before committing. Defines testing requirements and verification criteria.
- [SECURITY.md](SECURITY.md) — When touching auth, credentials, OAuth, input validation, or admin routes.
- [RELIABILITY.md](RELIABILITY.md) — When touching timeouts, retries, error handling, or graceful degradation paths.
- [FRONTEND.md](FRONTEND.md) — When touching the ui-agent, generated HTML pages, or anything served to the browser.
- [PRODUCT_SENSE.md](PRODUCT_SENSE.md) — When designing user-facing behavior, composing SMS responses, or making UX decisions.
- [db-schema.md](docs/archive/generated/db-schema.md) — When touching database tables or writing migrations.

**Read when starting a complex feature:**
- [PLANS.md](PLANS.md) — ExecPlan methodology. Read before creating a new plan.
- [exec-plans/completed/](docs/exec-plans/completed/) — Check for prior art when modifying a subsystem that was built via an ExecPlan.
- [design-docs/index.md](docs/archive/design-docs/index.md) — Find the relevant design doc for the subsystem you're modifying.

**Read when investigating issues:**
- [tech-debt-tracker.md](tech-debt-tracker.md) — Check for known gaps before introducing workarounds.

---

## Development Workflow

### ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in [PLANS.md](PLANS.md)) from design to implementation. Create the plan in `docs/exec-plans/active/` before writing code. Update it as you go.

### Design Docs

Design docs describe how a subsystem works and why it was built that way. Create or update a design doc in `docs/archive/design-docs/` when a change alters the architecture, introduces a new subsystem, or invalidates the existing description of how something works. If you're changing behavior that a design doc describes, update the doc in the same PR as the code change.

### After Making Code Changes

1. Write/update tests for new code paths and error modes
2. Run `npm run test:unit` and `npm run test:integration`
3. Fix failures before proceeding
4. Check if architecture docs need updating

### Before Committing

1. Verify tests pass: `npm run test:unit && npm run test:integration`
2. Run linter: `npm run lint`
3. Build to verify: `npm run build`
4. Update docs if applicable (ARCHITECTURE.md and/or relevant design doc)

---

## Adding New Agents

To add a new specialized agent:

1. Create `src/domains/<name>/capability.ts` and set `exposure: 'agent'`
2. Create `src/domains/<name>/runtime/agent.ts` and `src/domains/<name>/runtime/prompt.ts`
3. Define tools in `src/domains/<name>/runtime/tools.ts` if needed
4. Register tools in `src/tools/index.ts`
5. Import and add the domain agent to `AGENTS` in `src/registry/agents.ts` (before `general-agent`)
6. Write tests in `tests/unit/agents/<name>/` and/or `tests/unit/tools/` as appropriate

The agent will automatically be available to the planner and router.

## Adding New Tools

1. Create a `ToolDefinition` in the appropriate `src/tools/*.ts` file
2. Add it to `allTools` array in `src/tools/index.ts`
3. Add the tool name to the relevant domain agent capability in `src/domains/*/runtime/agent.ts`
4. If it's safe for scheduled execution, add to `READ_ONLY_TOOLS`

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
