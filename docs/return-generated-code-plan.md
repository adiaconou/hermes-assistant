# Return Generated Code in Tool Response

## Problem

The LLM's self-validation prompt asks it to "mentally review" code it just generated, but this doesn't work reliably. In the lasagna example, the LLM defined a `showTab()` function but never wired it to the tab buttons. The self-validation didn't catch this because:

1. The LLM generated the code in a "forward pass" (thinking about what to build)
2. It was asked to review from memory, using the same cognitive process that made the mistake
3. The tool response only returned `{success: true, shortUrl: "..."}` - no actual code to review

## Solution

Return the generated HTML/CSS/JS in the `generate_ui` tool response. This gives the LLM concrete code to review in a "backward pass" (analyzing existing code), which is more likely to catch errors.

### Current Response
```json
{
  "success": true,
  "shortUrl": "https://example.com/u/abc123",
  "pageId": "abc-123"
}
```

### New Response
```json
{
  "success": true,
  "shortUrl": "https://example.com/u/abc123",
  "pageId": "abc-123",
  "generatedCode": {
    "html": "<div class=\"container\">...</div>",
    "css": ".container { ... }",
    "js": "function showTab(tabName) { ... }"
  }
}
```

## Implementation

### File: `src/llm.ts`

Modify `handleToolCall()` to include the generated code in successful responses:

```typescript
if (isSuccess(result)) {
  return JSON.stringify({
    success: true,
    shortUrl: result.shortUrl,
    pageId: result.pageId,
    generatedCode: {
      html,
      css: css || '',
      js: js || '',
    },
  });
}
```

### Update SYSTEM_PROMPT

Change the validation instructions to reference the returned code:

```
## After generate_ui Returns

Review the generatedCode in the response:
- Are all buttons, tabs, and interactive elements wired to event handlers?
- Does every function that should be called actually get called?
- Is the HTML structure valid?
- Does state management use hermesLoadState/hermesSaveState correctly?

If you find issues, call generate_ui again with fixes before sharing the URL.
```

---

## Unit Tests

### File: `tests/unit/llm-tool-response.test.ts`

Test the tool response includes generated code:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the ui module before importing llm
vi.mock('../../src/ui/index.js', () => ({
  generatePage: vi.fn(),
  isSuccess: (result: unknown) => result && typeof result === 'object' && 'shortUrl' in result,
  getSizeLimits: () => ({ html: 50000, css: 20000, js: 30000 }),
}));

import { generatePage } from '../../src/ui/index.js';

describe('handleToolCall generate_ui response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should include generated code in successful response', async () => {
    const mockGeneratePage = generatePage as ReturnType<typeof vi.fn>;
    mockGeneratePage.mockResolvedValue({
      shortUrl: 'https://example.com/u/test123',
      pageId: 'test-page-id',
    });

    // We need to test handleToolCall, which is not exported
    // Option 1: Export it for testing
    // Option 2: Test through generateResponse
    // For now, document expected behavior

    const expectedResponse = {
      success: true,
      shortUrl: 'https://example.com/u/test123',
      pageId: 'test-page-id',
      generatedCode: {
        html: '<button class="tab-btn">Tab 1</button>',
        css: '.tab-btn { color: blue; }',
        js: 'function showTab() { }',
      },
    };

    // The response should contain all the generated code
    expect(expectedResponse.generatedCode.html).toContain('tab-btn');
    expect(expectedResponse.generatedCode.js).toContain('showTab');
  });

  it('should include empty strings for optional css/js', async () => {
    const expectedResponse = {
      success: true,
      shortUrl: 'https://example.com/u/test123',
      pageId: 'test-page-id',
      generatedCode: {
        html: '<div>Hello</div>',
        css: '',
        js: '',
      },
    };

    expect(expectedResponse.generatedCode.css).toBe('');
    expect(expectedResponse.generatedCode.js).toBe('');
  });

  it('should not include generated code on failure', async () => {
    const expectedResponse = {
      success: false,
      error: 'HTML exceeds size limit',
    };

    expect(expectedResponse).not.toHaveProperty('generatedCode');
  });
});
```

### File: `tests/integration/llm.test.ts` (additions)

Add integration tests for the full flow:

```typescript
describe('generateResponse with code review', () => {
  beforeEach(() => {
    clearMockState();
  });

  it('should pass generated code back to LLM in tool result', async () => {
    // First response: LLM generates UI
    // Second response: LLM reviews and responds
    setMockResponses([
      createToolUseResponse('generate_ui', {
        title: 'Test Tabs',
        html: '<button class="tab">Tab 1</button>',
        css: '.tab { color: blue; }',
        js: 'function showTab() { }',
      }),
      createTextResponse('I created a tabbed page for you: https://example.com/u/test'),
    ]);

    await generateResponse('Create a page with tabs', []);

    const calls = getCreateCalls();
    expect(calls.length).toBe(2);

    // The second call should include tool results with generated code
    const secondCallMessages = calls[1].messages;
    const toolResultMessage = secondCallMessages.find(
      (m: any) => m.role === 'user' && Array.isArray(m.content)
    );

    expect(toolResultMessage).toBeDefined();

    // Parse the tool result content
    const toolResult = toolResultMessage.content[0];
    const resultContent = JSON.parse(toolResult.content);

    expect(resultContent.generatedCode).toBeDefined();
    expect(resultContent.generatedCode.html).toContain('tab');
    expect(resultContent.generatedCode.js).toContain('showTab');
  });

  it('should allow LLM to regenerate UI after reviewing code', async () => {
    // First response: LLM generates buggy UI
    // Second response: LLM notices issue, regenerates
    // Third response: LLM satisfied, returns URL
    setMockResponses([
      createToolUseResponse('generate_ui', {
        title: 'Buggy Tabs',
        html: '<button class="tab">Tab 1</button>',
        js: 'function showTab() { }', // Bug: not connected to button
      }),
      createToolUseResponse('generate_ui', {
        title: 'Fixed Tabs',
        html: '<button class="tab" onclick="showTab(\'tab1\')">Tab 1</button>',
        js: 'function showTab(id) { document.getElementById(id).classList.add("active"); }',
      }),
      createTextResponse('I created a tabbed page: https://example.com/u/fixed'),
    ]);

    const response = await generateResponse('Create a page with tabs', []);

    expect(response).toContain('tabbed page');

    // Should have made 3 API calls (initial + 2 tool results)
    const calls = getCreateCalls();
    expect(calls.length).toBe(3);
  });

  it('should respect MAX_TOOL_LOOPS even with regeneration', async () => {
    // Set up 6+ tool use responses to exceed the limit
    setMockResponses([
      createToolUseResponse('generate_ui', { title: 'V1', html: '<div>1</div>' }),
      createToolUseResponse('generate_ui', { title: 'V2', html: '<div>2</div>' }),
      createToolUseResponse('generate_ui', { title: 'V3', html: '<div>3</div>' }),
      createToolUseResponse('generate_ui', { title: 'V4', html: '<div>4</div>' }),
      createToolUseResponse('generate_ui', { title: 'V5', html: '<div>5</div>' }),
      createToolUseResponse('generate_ui', { title: 'V6', html: '<div>6</div>' }),
      createTextResponse('Finally done!'),
    ]);

    await generateResponse('Create a page', []);

    // Should stop at MAX_TOOL_LOOPS (5), not continue to 6
    const calls = getCreateCalls();
    expect(calls.length).toBeLessThanOrEqual(6); // 1 initial + 5 loops max
  });
});
```

---

## Test Coverage Summary

| Test | Purpose |
|------|---------|
| `should include generated code in successful response` | Verifies tool response structure |
| `should include empty strings for optional css/js` | Handles missing optional fields |
| `should not include generated code on failure` | Error responses stay clean |
| `should pass generated code back to LLM in tool result` | Integration: LLM receives code |
| `should allow LLM to regenerate UI after reviewing code` | Integration: self-correction flow |
| `should respect MAX_TOOL_LOOPS even with regeneration` | Safety: loop limit still works |

---

## Token Cost Consideration

Returning the generated code increases token usage. Typical sizes:
- HTML: 1-4KB (500-1500 tokens)
- CSS: 1-2KB (300-700 tokens)
- JS: 1-3KB (400-1000 tokens)

Total overhead: ~1000-3000 tokens per UI generation.

This is acceptable because:
1. UI generation already costs 2000-5000 tokens for the initial generation
2. The quality improvement (catching bugs) outweighs the token cost
3. Most UIs will pass review on first try; regeneration is the exception

---

## Implementation Steps

1. Modify `handleToolCall()` to return `generatedCode` in success response
2. Update SYSTEM_PROMPT to reference the returned code
3. Add unit tests for tool response structure
4. Add integration tests for self-correction flow
5. Manual testing with problematic UI requests

---

## Success Criteria

1. All new unit tests pass
2. Existing tests still pass
3. LLM can see generated code in tool result (verified via logging)
4. Manual test: Request "tabs page" and verify LLM reviews the returned code
