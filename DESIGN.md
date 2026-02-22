# Design

Design patterns, coding guidelines, and TypeScript practices for Hermes Assistant.

For the high-level system architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).
For non-negotiable constraints, see [docs/archive/design-docs/core-beliefs.md](docs/archive/design-docs/core-beliefs.md).

---

## Key Design Patterns

### Two-Phase SMS Processing

Every inbound message goes through a fast sync path (<5s TwiML reply) and an optional async path (up to 5 minutes). The sync classifier decides whether async work is needed. This pattern ensures Twilio never times out waiting for a response.

### Agent Orchestration

Requests are decomposed by a planner LLM into discrete steps, each delegated to a specialized agent. Agents have isolated tool sets — a calendar-agent can't write to Drive, a drive-agent can't send emails. The general-agent is the fallback with access to all tools.

### Background Processing

Three background loops run independently: scheduler (30s), memory extraction (5min), email watcher (60s). None of these block or interfere with the SMS request path.

---

## Design Principles

- **Avoid over-engineering** — Keep solutions simple and focused on immediate requirements
- **Only implement what's needed** — Don't build features speculatively
- **No premature abstractions** — Three similar lines of code beats one wrong abstraction
- **Prefer explicit over clever** — Code should be immediately understandable
- **Refactor later, not sooner** — Working simple code beats elegant complex code

## TypeScript Practices

- **Strict mode** enabled in tsconfig
- **Prefer `type` over `interface`** unless you need extension/merging
- **Avoid `any`** — Use `unknown` if you truly don't know the type
- **No type assertions unless absolutely necessary** — `as` casts hide type errors
- ES modules (`"type": "module"` in package.json), module resolution `NodeNext`, target ES2022

## Code Quality

- **Document why, not what** — Comments explain decisions, not mechanics
- **Single responsibility** — Functions and modules do one thing well
- **Fail fast and loud** — Throw errors early; don't let bad state propagate
- **Keep error handling simple** — Roll up exception categories

## Dependencies

- **Minimize dependencies** — Evaluate if you really need a library
- **Prefer standard library** — Use built-in Node.js features when possible

---

## When to Create a New Agent vs. Extend an Existing One

Create a new agent when:
- The domain has its own set of tools (e.g., calendar has CRUD, drive has file ops)
- The agent needs a specialized system prompt with domain-specific instructions
- The functionality is self-contained and doesn't overlap with existing agents

Extend an existing agent when:
- Adding a tool that naturally belongs to an existing agent's domain
- The new behavior doesn't warrant a separate planning step

When in doubt, add a tool to an existing agent. New agents increase planner complexity.

---

## Cross-Cutting Concerns

| Concern | Pattern | Key file |
|---------|---------|----------|
| Date handling | `resolveDate()` / `resolveDateRange()` via chrono-node + Luxon | `src/services/date/resolver.ts` |
| Memory injection | Facts ranked by confidence, injected into agent prompts | `src/domains/memory/service/ranking.ts` |
| Conversation windowing | 24h / 20 messages / 4000 tokens sliding window | `src/orchestrator/conversation-window.ts` |
| User config | Timezone and name resolved per-phone-number | `src/services/user-config/sqlite.ts` |

---

## How to Add a New Domain Module

### File Structure

```
src/domains/<domain>/
├── types.ts          # Domain types, DTOs, error classes
├── capability.ts     # DomainCapability metadata (agent|tool-only|internal)
├── repo/             # Persistence (optional)
├── providers/        # Cross-cutting bridges (executor injection, cross-domain re-exports)
├── service/          # Business logic
└── runtime/          # Agent adapter, tool definitions, prompts
```

### Steps

1. Create `src/domains/<name>/types.ts` with domain types.
2. Create `capability.ts` with exposure level (`agent`, `tool-only`, or `internal`).
3. Add layers as needed (`repo` -> `providers` -> `service` -> `runtime`).
4. If the domain has an agent: create `runtime/agent.ts` with capability + executor, add to `src/registry/agents.ts`.
5. If the domain has tools: create `runtime/tools.ts`, import in `src/tools/index.ts`.
6. If the domain needs `executeWithTools`: create `providers/executor.ts` with injection pattern, wire in `src/index.ts`.
7. If the domain imports from another domain: create a `providers/<other-domain>.ts` bridge and add a `crossDomainRules` entry in `config/architecture-boundaries.json`.
8. Run `npm run lint:architecture` to verify 0 violations.
9. Run `npm run lint:agents` if the domain exposes an agent.

### Layer Rules

- **Forward-only**: `types` -> `config` -> `repo` -> `providers` -> `service` -> `runtime` -> `ui`
- Same-layer imports are allowed.
- Cross-domain imports MUST go through `providers/` bridges.
- External imports from domains are governed by `config/architecture-boundaries.json`.
