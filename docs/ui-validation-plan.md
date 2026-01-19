# UI Self-Validation Plan

## Overview

Add LLM self-validation to the UI generation system through prompt engineering. When the agent generates UI code, the system prompt instructs it to review its output and fix issues before returning the URL to the user.

## Problem Statement

The LLM sometimes generates UI code with issues:
- Broken HTML structure
- JavaScript syntax errors or runtime issues
- Missing requested functionality
- Poor mobile UX

Currently, the `generate_ui` tool returns a success response with a URL, and the LLM immediately shares this with the user without verifying the code works.

## Solution: Prompt-Based Self-Validation

Update the system prompt to instruct the LLM to validate its generated code before sharing the URL. The existing tool loop already supports retries naturally—we just need to tell the LLM to use it.

---

## Implementation Steps

### Step 1: Update System Prompt

**File:** `src/llm.ts`
**Constant:** `SYSTEM_PROMPT` (around line 134)

Add after existing UI generation instructions:

```typescript
const SYSTEM_PROMPT = `You are a helpful SMS assistant...

// ... existing content ...

## Before Sharing UI URLs

After calling generate_ui, mentally review your code:
- Is the HTML structure valid (proper nesting, closed tags)?
- Does the JavaScript have syntax errors (typos, missing brackets)?
- Did you implement all requested functionality?
- Will it work on mobile (touch-friendly, responsive)?
- Does state management use hermesLoadState/hermesSaveState correctly?

If you spot issues, call generate_ui again with fixes. Only share the URL once confident the page works.`;
```

### Step 2: Add Loop Safeguard (Optional)

**File:** `src/llm.ts`
**Function:** `generateResponse()` (around line 310)

Add a simple safeguard to prevent runaway tool loops:

```typescript
// Handle tool use loop
let loopCount = 0;
const MAX_TOOL_LOOPS = 5;

while (response.stop_reason === 'tool_use') {
  loopCount++;

  if (loopCount > MAX_TOOL_LOOPS) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'Tool loop limit reached',
      loopCount,
      timestamp: new Date().toISOString(),
    }));
    break;
  }

  // ... rest of existing loop code ...
}
```

---

## Testing

### Manual Testing

1. Start dev server: `npm run dev`
2. Send SMS: "Create a todo list app with add and delete functionality"
3. Check server logs for:
   - Multiple `generate_ui` calls if LLM found issues in its review
   - `loopCount` values in logs
   - Final response after validation passes

### Test Cases

1. **Simple request**: "Make me a grocery list" - should work first try
2. **Complex request**: "Create a habit tracker with weekly view and streak counting" - may require self-correction
3. **Edge case**: Observe if LLM ever hits the loop limit (indicates prompt needs tuning)

---

## Rollout Plan

1. **Phase 1:** Update system prompt in `src/llm.ts`
2. **Phase 2:** Add loop safeguard
3. **Phase 3:** Manual testing with various UI requests
4. **Phase 4:** Monitor production logs for validation behavior
5. **Phase 5:** Tune prompt wording based on observed LLM behavior

---

## Success Metrics

- Reduced user complaints about broken UIs
- No runaway loops (safeguard never triggered, or rarely)
- Minimal latency increase (most requests should still be single-attempt)

---

## Why This Approach

### Simplicity First

The original plan proposed:
- A wrapper function for attempt tracking
- Returning generated code in tool responses
- Complex test infrastructure

This approach uses:
- ~10 lines of prompt text
- ~5 lines of safeguard code

### YAGNI Applied

- **Don't return generated code**: The LLM remembers what it just generated within the same turn. Returning it doubles token usage for no benefit.
- **Don't add attempt tracking**: The existing tool loop handles retries. A simple `loopCount` check is sufficient as a safeguard.
- **Don't add wrapper functions**: Premature abstraction. The existing code structure handles this naturally.

### Prompt Engineering > Code Complexity

The core insight: if the LLM isn't validating its work, fix the prompt first. Add defensive code only after observing actual failures.

---

## Alternatives Considered

### Complex Attempt Tracking (Original Plan)
- Pros: Explicit control over retry behavior
- Cons: Adds ~50 lines of code, wrapper function, increases complexity
- **Rejected:** Simple loop guard achieves the same safety with 5 lines

### Returning Generated Code in Response
- Pros: LLM can "see" what it generated
- Cons: Doubles token usage, LLM already knows what it generated
- **Rejected:** Unnecessary token cost

### Separate `validate_ui` Tool
- Pros: Explicit validation step
- Cons: LLM might not call it; adds complexity
- **Rejected:** Prompt-based validation is simpler and automatic

### Headless Browser Validation
- Pros: Actual runtime testing
- Cons: Heavy dependency, slow, complex setup
- **Rejected:** User explicitly requested no headless browser

### Static Analysis Only
- Pros: Fast, deterministic
- Cons: Can't catch semantic issues (wrong functionality)
- **Rejected:** LLM review catches more issues than static analysis alone
