# Skills System Implementation Plan

Design: [design-docs/skills-system-design.md](../../design-docs/skills-system-design.md)

---

## Phase 1: Foundation (new files, no behavior changes)

| Step | File | What |
|------|------|------|
| 1.1 | `src/services/skills/types.ts` | Create `Skill`, `SkillExecutionContext`, `SkillExecutionResult`, `SkillMatchResult`, `SkillValidationError` types |
| 1.2 | `src/skills/deployed/tax-tracker.ts` | Migrate DEFAULT_SKILLS[0] to standalone module |
| 1.3 | `src/skills/deployed/expense-tracker.ts` | Migrate DEFAULT_SKILLS[1] |
| 1.4 | `src/skills/deployed/invite-detector.ts` | Migrate DEFAULT_SKILLS[2] |
| 1.5 | `src/skills/deployed/index.ts` | Export `DEPLOYED_SKILLS: Skill[]` |
| 1.6 | `src/skills/validator.ts` | Move `validateSkillDefinition()` from email-watcher/skills.ts, export `ALLOWED_SKILL_TOOLS` |
| 1.7 | `src/services/skills/sqlite.ts` | Create `SkillStore` class with DB migration from `email_skills`, singleton `getSkillStore()` |
| 1.8 | `src/skills/index.ts` | Skill registry — `getSkillsForUser()`, `findSkill()` merging deployed + runtime |
| 1.9 | `src/skills/executor.ts` | Unified execution — `executeSkill()`, `executeSkillAndNotify()`, `buildSkillContext()` |
| 1.10 | `src/skills/classifier.ts` | Message-to-skill matcher — `matchMessageToSkills()` using Haiku, 0.7 confidence threshold |

## Phase 2: Rewire consumers

| Step | File | What |
|------|------|------|
| 2.1 | `src/services/email-watcher/types.ts` | Remove `EmailSkill` type (keep IncomingEmail, ClassificationResult, SkillMatch, ThrottleState) |
| 2.2 | `src/services/email-watcher/prompt.ts` | Change `EmailSkill[]` param to `Skill[]` |
| 2.3 | `src/services/email-watcher/classifier.ts` | Replace `getEmailSkillStore()` with `getSkillsForUser(phone, { emailOnly: true })` |
| 2.4 | `src/services/email-watcher/actions.ts` | Replace `executeToolAction()` + `buildMinimalContext()` with `executeSkill()` + `buildSkillContext()` |
| 2.5 | `src/services/email-watcher/skills.ts` | Replace `getEmailSkillStore()` with `getSkillStore()`, use `DEPLOYED_SKILLS`, remove `DEFAULT_SKILLS` and `validateSkillDefinition()` |
| 2.6 | `src/index.ts` | Add `getSkillStore(db)` initialization before scheduler init |

## Phase 3: New invocation paths

| Step | File | What |
|------|------|------|
| 3.1 | `src/routes/sms.ts` | Insert skill matching in `processAsyncWork()` BEFORE orchestrator call. Only for text messages (no media), only if user has `matchOnMessage` skills. On match → `executeSkill()` → send response → return (bypass orchestrator) |
| 3.2 | `src/services/scheduler/types.ts` | Add `skillName?: string` to `ScheduledJob` and `CreateJobInput` |
| 3.3 | `src/services/scheduler/sqlite.ts` | Add `skill_name TEXT` column migration, update `rowToJob()` and `createJob()` |
| 3.4 | `src/services/scheduler/executor.ts` | Before prompt execution: if `job.skillName` → `findSkill()` → `executeSkillAndNotify()` |

## Phase 4: Rename tools and admin UI

| Step | File | What |
|------|------|------|
| 4.1 | `src/tools/skills.ts` (new) | Create with renamed tools: `create_skill`, `list_skills`, `update_skill`, `delete_skill`, `test_skill`. Add `match_on_email`/`match_on_message` params to `create_skill` and `update_skill`. Use `getSkillStore()` + `validateSkillDefinition()` from new locations |
| 4.2 | `src/tools/index.ts` | Update imports from `./skills.js`, update variable names |
| 4.3 | `src/agents/email/index.ts` | Update `EMAIL_TOOLS` array with new tool names |
| 4.4 | `src/agents/email/prompt.ts` | Update `create_email_skill` → `create_skill` in instructions |
| 4.5 | `src/admin/skills.ts` (new) | Admin API handlers using `getSkillStore()`, add `matchOnEmail`/`matchOnMessage` to create/update |
| 4.6 | `src/admin/views/skills.html` (new) | Updated HTML with `/admin/api/skills/*` endpoints and match scope fields |
| 4.7 | `src/admin/index.ts` | Switch imports to `./skills.js`, routes to `/admin/skills`, redirect old `/admin/email-skills` |

## Phase 5: Cleanup

| Step | What |
|------|------|
| 5.1 | Delete `src/services/email-watcher/sqlite.ts` (replaced by `src/services/skills/sqlite.ts`) |
| 5.2 | Delete `src/tools/email-skills.ts` (replaced by `src/tools/skills.ts`) |
| 5.3 | Delete `src/admin/email-skills.ts` (replaced by `src/admin/skills.ts`) |
| 5.4 | Delete `src/admin/views/email-skills.html` (replaced by `src/admin/views/skills.html`) |
| 5.5 | Remove all remaining `EmailSkill`, `getEmailSkillStore`, `email_skill` references |
| 5.6 | Update test fixtures (email-skill tests → skill tests) |
| 5.7 | `npm run build` — type check passes |
| 5.8 | `npm run lint` — no lint errors |
| 5.9 | `npm run test:unit` — tests pass |

---

## Files Summary

### New files (10)

| File | Purpose |
|------|---------|
| `src/services/skills/types.ts` | Skill type definitions |
| `src/services/skills/sqlite.ts` | SkillStore (DB CRUD + migration from email_skills) |
| `src/skills/index.ts` | Skill registry (deployed + runtime merge) |
| `src/skills/executor.ts` | Unified skill execution |
| `src/skills/classifier.ts` | Message-to-skill matcher |
| `src/skills/validator.ts` | Skill validation (moved from email-watcher) |
| `src/skills/deployed/index.ts` | Deployed skill registry |
| `src/skills/deployed/tax-tracker.ts` | Deployed skill |
| `src/skills/deployed/expense-tracker.ts` | Deployed skill |
| `src/skills/deployed/invite-detector.ts` | Deployed skill |

### Renamed files (3)

| Old | New |
|-----|-----|
| `src/tools/email-skills.ts` | `src/tools/skills.ts` |
| `src/admin/email-skills.ts` | `src/admin/skills.ts` |
| `src/admin/views/email-skills.html` | `src/admin/views/skills.html` |

### Modified files (12)

| File | Change |
|------|--------|
| `src/services/email-watcher/types.ts` | Remove `EmailSkill` type |
| `src/services/email-watcher/prompt.ts` | Accept `Skill[]` instead of `EmailSkill[]` |
| `src/services/email-watcher/classifier.ts` | Use skill registry instead of EmailSkillStore |
| `src/services/email-watcher/actions.ts` | Use skill executor instead of own executeToolAction |
| `src/services/email-watcher/skills.ts` | Use SkillStore + DEPLOYED_SKILLS |
| `src/index.ts` | Add SkillStore initialization |
| `src/routes/sms.ts` | Insert skill matching before orchestrator |
| `src/services/scheduler/types.ts` | Add `skillName` field |
| `src/services/scheduler/sqlite.ts` | Add `skill_name` column |
| `src/services/scheduler/executor.ts` | Add skill execution branch |
| `src/tools/index.ts` | Update imports |
| `src/agents/email/index.ts` | Update tool names |

### Deleted files (2)

| File | Reason |
|------|--------|
| `src/services/email-watcher/sqlite.ts` | Replaced by `src/services/skills/sqlite.ts` |
| `src/admin/views/email-skills.html` | Replaced by `src/admin/views/skills.html` |

---

## Deferred / Out of Scope

- New deployed skills (daily-briefing, etc.) — add after the infrastructure is in place
- Skill analytics / versioning
- Skill-to-skill chaining
- Webhook triggers
- Per-skill rate limiting
- Custom executors on deployed skills

---

## Verification

1. `npm run build` — type check passes
2. `npm run lint` — no lint errors
3. `npm run test:unit` — existing tests pass (update email-skill test fixtures)
4. Manual: verify email watcher still processes emails with default skills
5. Manual: verify SMS tools (`create_skill`, `list_skills`) work via the orchestrator
6. Manual: verify admin UI at `/admin/skills` loads and shows skills
7. Manual: verify DB migration works (start app with existing `email_skills` data → migrated to `skills` table)
8. Manual: send a message that matches a `matchOnMessage` skill → verify it bypasses orchestrator
