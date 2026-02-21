# Core Beliefs

Agent-first operating principles for working in this codebase. These define how you should think, make decisions, and write code — not how the system is built (see [ARCHITECTURE.md](../../ARCHITECTURE.md) for that).

Treat these as the tiebreaker when two reasonable approaches conflict.

---

## Simplicity-first

Working simple code beats elegant complex code. Every line you add is a line someone (or some agent) has to understand later.

- Don't build features speculatively. Only implement what the current task requires.
- Three similar lines of code beat one wrong abstraction. Deduplicate when a pattern appears three or more times, not before.
- Prefer flat over nested. Prefer explicit over clever. Prefer boring over novel.
- When choosing between "this works" and "this is architecturally pure," pick the one that works.
- Error handling should match the real failure modes. Don't add try/catch for things that can't fail. Don't add validation for data you control.

## Context over memory

Never assume you know how the code works — read it. The source of truth is always the current file on disk, not what you remember from a previous conversation or what seems likely.

- Read the file before modifying it. Read the tests before writing new ones. Read the caller before changing a function signature.
- If a doc says one thing and the code says another, the code wins. Flag the discrepancy but follow the code.
- When modifying a subsystem, check the [design-docs index](index.md) for the relevant design doc. When implementing a feature, check [completed exec plans](../exec-plans/completed/) for prior art.
- Don't reference external blogs, docs, or Stack Overflow answers in code comments or plans. If knowledge is needed, embed it in your own words.

## Ship incrementally

Every commit should leave the system in a working state. Small changes that build on each other beat large changes that arrive all at once.

- Prefer additive changes. Add the new path, verify it works, then remove the old one. Don't replace things in a single step.
- Each change should be independently testable and verifiable. If you can't prove a change works in isolation, it's too big.
- Commit frequently. A commit that does one thing well is better than a commit that does five things at once.
- When a task is too large to ship atomically, break it into milestones. Each milestone must produce demonstrably working behavior, not just code changes.
- If tests fail, stop and fix them before moving forward. Never defer broken tests.

## Technology selection

Prefer boring technology. Technologies that are well-established, widely documented, and stable are easier for both humans and agents to reason about.

- Favor dependencies that can be fully understood from their in-repo usage. If a library requires reading an external tutorial to use correctly, that's a cost.
- Prefer composable, single-purpose libraries over large frameworks. A small dependency with a clear API beats a large one with implicit behavior.
- When evaluating a new dependency, consider: Is this well-represented in training data? Does it have a stable API? Can an agent read the types and figure out how to use it?
- Keep the dependency tree shallow. Every transitive dependency is a risk surface you don't control.
- When in doubt, write it yourself — but only if it's simple. The threshold is: can you implement and test it in under an hour? If not, find a library.
