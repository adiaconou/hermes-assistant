# Detailed Agent Instructions for Hermes Assistant Development

**For project overview and quick start, see [CLAUDE.md](CLAUDE.md)**

This document contains detailed operational instructions for AI agents working on hermes-assistant development, testing, and releases.

## Development Guidelines

### Code Standards

- **Node.js version**: 18+
- **Linting**: `npm run lint`
- **Testing**: All new features need tests (`npm test` for local, full tests run in CI)
- **Documentation**: Update relevant .md files

### File Organization

```
hermes-assistant/
├── src/
│   ├── index.ts         # Entry point
│   ├── server.ts        # Express server setup
│   ├── webhook/         # Twilio webhook handlers
│   ├── config/          # Environment and configuration
│   └── types/           # TypeScript type definitions
├── dist/                # Compiled output
├── docs/                # Requirements and specifications
└── *.md                 # Documentation
```

### Testing Workflow

**IMPORTANT:** Never pollute production with test data!

**For manual testing**, use environment variables to isolate test runs:

```bash
# Run tests in isolation
npm test

# Or for quick manual testing with dev server
npm run dev
```

**For automated tests**, use test fixtures and mocks:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('MyFeature', () => {
  it('should work', () => {
    const mockTwilio = vi.fn();
    // ... test code
  });
});
```

**Warning:** Always mock external services (Twilio, Anthropic, Google) in tests.

### Before Committing

1. **Run tests**: `npm test`
2. **Run linter**: `npm run lint`
3. **Build to verify**: `npm run build`
4. **Update docs**: If you changed behavior, update README.md or other docs
5. **Commit**: Issues auto-sync to `.beads/issues.jsonl` and import after pull

### Commit Message Convention

When committing work for an issue, include the issue ID in parentheses at the end:

```bash
git commit -m "Fix auth validation bug (hermes-assistant-abc)"
git commit -m "Add retry logic for webhook handling (hermes-assistant-xyz)"
```

This enables `bd doctor` to detect **orphaned issues** - work that was committed but the issue wasn't closed. The doctor check cross-references open issues against git history to find these orphans.

### Git Workflow

**Auto-sync provides batching!** bd automatically:

- **Exports** to JSONL after CRUD operations (30-second debounce for batching)
- **Imports** from JSONL when it's newer than DB (e.g., after `git pull`)
- **Daemon commits/pushes** every 5 seconds (if `--auto-commit` / `--auto-push` enabled)

The 30-second debounce provides a **transaction window** for batch operations - multiple issue changes within 30 seconds get flushed together, avoiding commit spam.

### Git Integration

**Auto-sync**: bd automatically exports to JSONL (30s debounce), imports after `git pull`, and optionally commits/pushes.

**Protected branches**: Use `bd init --branch beads-metadata` to commit to separate branch. See [beads docs](https://github.com/steveyegge/beads/blob/main/docs/PROTECTED_BRANCHES.md).

**Git worktrees**: Enhanced support with shared database architecture. Use `bd --no-daemon` if daemon warnings appear.

**Merge conflicts**: Rare with hash IDs. If conflicts occur, use `git checkout --theirs .beads/issues.jsonl` and `bd import`.

## Landing the Plane

**When the user says "let's land the plane"**, you MUST complete ALL steps below. The plane is NOT landed until `git push` succeeds. NEVER stop before pushing. NEVER say "ready to push when you are!" - that is a FAILURE.

**MANDATORY WORKFLOW - COMPLETE ALL STEPS:**

1. **File beads issues for any remaining work** that needs follow-up
2. **Ensure all quality gates pass** (only if code changes were made):
   - Run `npm run lint`
   - Run `npm test`
   - Run `npm run build`
   - File P0 issues if quality gates are broken
3. **Update beads issues** - close finished work, update status
4. **PUSH TO REMOTE - NON-NEGOTIABLE** - This step is MANDATORY. Execute ALL commands below:
   ```bash
   # Pull first to catch any remote changes
   git pull --rebase

   # If conflicts in .beads/issues.jsonl, resolve thoughtfully:
   #   - git checkout --theirs .beads/issues.jsonl (accept remote)
   #   - bd import -i .beads/issues.jsonl (re-import)
   #   - Or manual merge, then import

   # Sync the database (exports to JSONL, commits)
   bd sync

   # MANDATORY: Push everything to remote
   # DO NOT STOP BEFORE THIS COMMAND COMPLETES
   git push

   # MANDATORY: Verify push succeeded
   git status  # MUST show "up to date with origin/main"
   ```

   **CRITICAL RULES:**
   - The plane has NOT landed until `git push` completes successfully
   - NEVER stop before `git push` - that leaves work stranded locally
   - NEVER say "ready to push when you are!" - YOU must push, not the user
   - If `git push` fails, resolve the issue and retry until it succeeds
   - The user is managing multiple agents - unpushed work breaks their coordination workflow

5. **Clean up git state** - Clear old stashes and prune dead remote branches:
   ```bash
   git stash clear                    # Remove old stashes
   git remote prune origin            # Clean up deleted remote branches
   ```
6. **Verify clean state** - Ensure all changes are committed AND PUSHED, no untracked files remain
7. **Choose a follow-up issue for next session**
   - Provide a prompt for the user to give to you in the next session
   - Format: "Continue work on hermes-assistant-X: [issue title]. [Brief context about what's been done and what's next]"

**REMEMBER: Landing the plane means EVERYTHING is pushed to remote. No exceptions. No "ready when you are". PUSH IT.**

**Example "land the plane" session:**

```bash
# 1. File remaining work
bd create "Add integration tests for webhook" -t task -p 2 --json

# 2. Run quality gates (only if code changes were made)
npm test
npm run lint
npm run build

# 3. Close finished issues
bd close hermes-assistant-42 hermes-assistant-43 --reason "Completed" --json

# 4. PUSH TO REMOTE - MANDATORY, NO STOPPING BEFORE THIS IS DONE
git pull --rebase
# If conflicts in .beads/issues.jsonl, resolve thoughtfully:
#   - git checkout --theirs .beads/issues.jsonl (accept remote)
#   - bd import -i .beads/issues.jsonl (re-import)
#   - Or manual merge, then import
bd sync        # Export/import/commit
git push       # MANDATORY - THE PLANE IS STILL IN THE AIR UNTIL THIS SUCCEEDS
git status     # MUST verify "up to date with origin/main"

# 5. Clean up git state
git stash clear
git remote prune origin

# 6. Verify everything is clean and pushed
git status

# 7. Choose next work
bd ready --json
bd show hermes-assistant-44 --json
```

**Then provide the user with:**

- Summary of what was completed this session
- What issues were filed for follow-up
- Status of quality gates (all passing / issues filed)
- Confirmation that ALL changes have been pushed to remote
- Recommended prompt for next session

**CRITICAL: Never end a "land the plane" session without successfully pushing. The user is coordinating multiple agents and unpushed work causes severe rebase conflicts.**

## Agent Session Workflow

**WARNING: DO NOT use `bd edit`** - it opens an interactive editor ($EDITOR) which AI agents cannot use. Use `bd update` with flags instead:
```bash
bd update <id> --description "new description"
bd update <id> --title "new title"
bd update <id> --design "design notes"
bd update <id> --notes "additional notes"
bd update <id> --acceptance "acceptance criteria"
```

**IMPORTANT for AI agents:** When you finish making issue changes, always run:

```bash
bd sync
```

This immediately:

1. Exports pending changes to JSONL (no 30s wait)
2. Commits to git
3. Pulls from remote
4. Imports any updates
5. Pushes to remote

**Example agent session:**

```bash
# Make multiple changes (batched in 30-second window)
bd create "Fix bug" -p 1
bd create "Add tests" -p 1
bd update hermes-assistant-42 --status in_progress
bd close hermes-assistant-40 --reason "Completed"

# Force immediate sync at end of session
bd sync

# Now safe to end session - everything is committed and pushed
```

**Why this matters:**

- Without `bd sync`, changes sit in 30-second debounce window
- User might think you pushed but JSONL is still dirty
- `bd sync` forces immediate flush/commit/push

**STRONGLY RECOMMENDED: Install git hooks for automatic sync** (prevents stale JSONL problems):

```bash
# One-time setup - run this in each beads workspace
bd hooks install
```

This installs:

- **pre-commit** - Flushes pending changes immediately before commit (bypasses 30s debounce)
- **post-merge** - Imports updated JSONL after pull/merge (guaranteed sync)
- **pre-push** - Exports database to JSONL before push (prevents stale JSONL from reaching remote)
- **post-checkout** - Imports JSONL after branch checkout (ensures consistency)

**Why git hooks matter:**
Without the pre-push hook, you can have database changes committed locally but stale JSONL pushed to remote, causing multi-workspace divergence. The hooks guarantee DB ↔ JSONL consistency.

**Note:** Hooks are embedded in the bd binary and work for all bd users (not just source repo users).

## Common Development Tasks

### Adding a New Endpoint

1. Create handler in `src/webhook/` or appropriate feature directory
2. Register route in `src/server.ts`
3. Add types to `src/types/`
4. Add tests
5. Document in README.md if public API

### Adding Storage Features

1. Update schema/types in `src/types/`
2. Add migration if using SQLite (Phase 2+)
3. Implement storage logic
4. Add tests
5. Update any import/export logic

### Adding Examples

1. Create directory in `examples/`
2. Add README.md explaining the example
3. Include working code
4. Link from main README.md

## Building and Testing

```bash
# Build
npm run build

# Test
npm test

# Test with coverage
npm test -- --coverage

# Run locally
npm run dev

# Run production build
npm start
```

## Checking GitHub Issues and PRs

**IMPORTANT**: When asked to check GitHub issues or PRs, use command-line tools like `gh` instead of browser/playwright tools.

**Preferred approach:**

```bash
# List open issues with details
gh issue list --limit 30

# List open PRs
gh pr list --limit 30

# View specific issue
gh issue view 201
```

**Then provide an in-conversation summary** highlighting:

- Urgent/critical issues (regressions, bugs, broken builds)
- Common themes or patterns
- Feature requests with high engagement
- Items that need immediate attention

**Why this matters:**

- Browser tools consume more tokens and are slower
- CLI summaries are easier to scan and discuss
- Keeps the conversation focused and efficient
- Better for quick triage and prioritization

**Do NOT use:** `browser_navigate`, `browser_snapshot`, or other playwright tools for GitHub PR/issue reviews unless specifically requested by the user.

## Questions?

- Check existing issues: `bd list`
- Look at recent commits: `git log --oneline -20`
- Read the docs: README.md, CLAUDE.md, docs/
- Create an issue if unsure: `bd create "Question: ..." -t task -p 2`

## Important Files

- **CLAUDE.md** - Project overview, architecture, coding guidelines
- **README.md** - Quick start and project overview
- **docs/requirements.md** - Full product requirements
- **docs/phase-1-requirements.md** - Phase 1 MVP specification
