# Quality Score

Quality standards, testing requirements, and verification criteria.

---

## Testing Requirements

**Every code change must include appropriate tests and all tests must pass.**

### What to Test

- Unit tests for major code paths and key branches
- Unit tests for error handling and edge cases
- Integration tests for key workflows
- **Mock external services** — Never call real Twilio, Anthropic, Google, or Gemini APIs in tests

### Testing Stack

| Tool | Purpose |
|------|---------|
| **Vitest** | Test framework and runner |
| **Supertest** | HTTP integration testing |
| **Vitest mocks** | Module mocking + custom mocks in `tests/mocks/` |
| **vitest.config.ts** | Aliases `@anthropic-ai/sdk` to mock |

### Commands

```bash
npm test                 # Run all tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run lint             # ESLint
npm run build            # TypeScript type check + compile
```

---

## Definition of Done

A feature is complete when:

1. All new code paths have unit tests
2. `npm run test:unit` passes
3. `npm run test:integration` passes
4. `npm run lint` passes (no new warnings)
5. `npm run build` succeeds
6. Architecture docs updated if system design changed
7. Design doc created/updated if the feature involves architectural decisions

---

## Code Quality Checklist

- [ ] No `any` types (use `unknown` if needed)
- [ ] No type assertions (`as`) unless absolutely necessary
- [ ] Error handling is consistent (fail fast, throw early)
- [ ] No sensitive data in logs (tokens, API keys, full phone numbers)
- [ ] External services are mocked in tests
- [ ] Comments explain "why", not "what"
- [ ] No unused imports, variables, or dead code

---

## Before Committing

```bash
npm run test:unit && npm run test:integration  # Tests pass
npm run lint                                     # No lint errors
npm run build                                    # Types check out
```
