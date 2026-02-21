# LLM.ts Refactoring Plan

## Problem

`src/llm.ts` is 2,197 lines handling too many concerns:
- Tool definitions (18 tools, ~400 lines)
- Tool execution (1,130 lines in a massive if-else cascade)
- System prompts (127 lines inline)
- Memory/context building
- LLM orchestration

## Goal

Break into smaller logical chunks. Replace if-else cascade with a simple tool map.

---

## Proposed Structure

```
src/llm/
├── index.ts              # Main orchestration (~300 lines)
├── client.ts             # Anthropic client singleton
├── types.ts              # ToolDefinition type + ToolContext
├── prompts.ts            # System prompt + context builders
├── tools/
│   ├── index.ts          # Exports all tools + TOOLS array + handler map
│   ├── utils.ts          # Shared helpers (requirePhoneNumber, handleAuthError)
│   ├── calendar.ts       # All 5 calendar tools
│   ├── email.ts          # get_emails, read_email
│   ├── memory.ts         # All 4 memory tools
│   ├── user-config.ts    # set_user_config, delete_user_data
│   ├── scheduler.ts      # All 4 scheduler tools
│   └── ui.ts             # generate_ui
```

**Design principles:**
- One file per domain instead of one file per tool
- No registry class/interface - just a `Map<string, handler>`
- No tags system - keep `READ_ONLY_TOOLS` as simple array
- Combined prompts into single file

---

## Tool Abstraction (Minimal)

### Types (`types.ts`)

```typescript
import type { Tool } from '@anthropic-ai/sdk/resources/messages';

// Context passed to handlers
export interface ToolContext {
  phoneNumber?: string;
  channel?: 'sms' | 'whatsapp';
}

// Handler function type
export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext
) => Promise<Record<string, unknown>>;

// Pairs a tool definition with its handler
export interface ToolDefinition {
  tool: Tool;
  handler: ToolHandler;
}
```

### Tool File Example (`tools/calendar.ts`)

```typescript
import type { ToolDefinition, ToolContext } from '../types.js';
import { requirePhoneNumber, handleAuthError } from './utils.js';
import { listEvents, createEvent, ... } from '../../services/google/calendar.js';

export const getCalendarEvents: ToolDefinition = {
  tool: {
    name: 'get_calendar_events',
    description: "Get events from the user's Google Calendar...",
    input_schema: { /* current schema */ },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { start_date, end_date } = input as { start_date: string; end_date?: string };

    try {
      const events = await listEvents(phoneNumber, new Date(start_date), ...);
      return { success: true, events };
    } catch (error) {
      return handleAuthError(error, phoneNumber) ?? { success: false, error: String(error) };
    }
  },
};

export const createCalendarEvent: ToolDefinition = { ... };
// etc.
```

### Tool Index (`tools/index.ts`)

```typescript
import * as calendar from './calendar.js';
import * as email from './email.js';
import * as memory from './memory.js';
// ...

// All tool definitions
const allTools: ToolDefinition[] = [
  calendar.getCalendarEvents,
  calendar.createCalendarEvent,
  // ...all 18 tools
];

// For Anthropic API
export const TOOLS = allTools.map(t => t.tool);

// For execution - replaces the if-else cascade
export const toolHandlers = new Map(
  allTools.map(t => [t.tool.name, t.handler])
);

// Keep simple array like before
export const READ_ONLY_TOOLS = [
  calendar.getCalendarEvents.tool,
  memory.listMemories.tool,
  // ...
];
```

### Main Orchestration (`index.ts`)

```typescript
// In generateResponse(), replace:
// const result = await handleToolCall(name, input, phoneNumber);

// With:
const handler = toolHandlers.get(name);
if (!handler) {
  return JSON.stringify({ error: `Unknown tool: ${name}` });
}
const result = await handler(input, { phoneNumber, channel });
return JSON.stringify(result);
```

---

## Step-by-Step Implementation

### Step 1: Create directory structure
```bash
mkdir -p src/llm/tools
```

### Step 2: Create `src/llm/types.ts`
- [ ] Define `ToolContext` interface
- [ ] Define `ToolHandler` type
- [ ] Define `ToolDefinition` interface
- [ ] Export `GenerateOptions` and `ClassificationResult` (move from llm.ts lines 54-70)

### Step 3: Create `src/llm/tools/utils.ts`
- [ ] Move `endOfDay()` helper (llm.ts line 749-753)
- [ ] Move `isValidTimezone()` helper (llm.ts lines 758-765)
- [ ] Create `requirePhoneNumber(context)` - throws if missing
- [ ] Create `handleAuthError(error, phoneNumber)` - returns auth result or null

### Step 4: Create `src/llm/prompts.ts`
- [ ] Move `SYSTEM_PROMPT` constant (llm.ts lines 209-335)
- [ ] Move `buildClassificationPrompt()` (llm.ts lines 100-126)
- [ ] Move `buildTimeContext()` (llm.ts lines 76-95)
- [ ] Move `buildMemoryXml()` (llm.ts lines 1909-1959)
- [ ] Move `buildUserContext()` (llm.ts lines 1961-2006)

### Step 5: Create `src/llm/tools/user-config.ts`
- [ ] Move `set_user_config` tool definition (llm.ts lines 456-490)
- [ ] Move `set_user_config` handler (llm.ts lines 1044-1095)
- [ ] Move `delete_user_data` tool definition (llm.ts lines 492-504)
- [ ] Move `delete_user_data` handler (llm.ts lines 1097-1126)
- [ ] Export as `ToolDefinition` objects

### Step 6: Create `src/llm/tools/memory.ts`
- [ ] Move `extract_memory` tool + handler (lines 506-546, 1128-1207)
- [ ] Move `list_memories` tool + handler (lines 548-560, 1209-1255)
- [ ] Move `update_memory` tool + handler (lines 562-590, 1257-1303)
- [ ] Move `remove_memory` tool + handler (lines 592-614, 1305-1343)

### Step 7: Create `src/llm/tools/calendar.ts`
- [ ] Move `get_calendar_events` tool + handler (lines 358-382, 844-889)
- [ ] Move `create_calendar_event` tool + handler (lines 384-418, 891-940)
- [ ] Move `update_calendar_event` tool + handler (lines 420-454, 942-1002)
- [ ] Move `delete_calendar_event` tool + handler (lines 616-632, 1004-1042)
- [ ] Move `resolve_date` tool + handler (lines 634-668, 1345-1448)

### Step 8: Create `src/llm/tools/email.ts`
- [ ] Move `get_emails` tool + handler (lines 670-704, 1773-1837)
- [ ] Move `read_email` tool + handler (lines 706-736, 1839-1898)

### Step 9: Create `src/llm/tools/scheduler.ts`
- [ ] Move `create_scheduled_job` tool + handler (lines 738-??, 1450-1580)
- [ ] Move `list_scheduled_jobs` tool + handler (1582-1634)
- [ ] Move `update_scheduled_job` tool + handler (1636-1725)
- [ ] Move `delete_scheduled_job` tool + handler (1727-1771)

### Step 10: Create `src/llm/tools/ui.ts`
- [ ] Move `generate_ui` tool + handler (lines 340-356, 784-842)

### Step 11: Create `src/llm/tools/index.ts`
- [ ] Import all tool modules
- [ ] Create `allTools` array with all `ToolDefinition` objects
- [ ] Export `TOOLS = allTools.map(t => t.tool)`
- [ ] Export `toolHandlers = new Map(...)`
- [ ] Export `READ_ONLY_TOOLS` array

### Step 12: Create `src/llm/client.ts`
- [ ] Move `getClient()` function (llm.ts lines 37-47)
- [ ] Export singleton Anthropic client

### Step 13: Create `src/llm/index.ts`
- [ ] Import from `./client.js`, `./prompts.js`, `./tools/index.js`
- [ ] Move `classifyMessage()` (llm.ts lines 132-207)
- [ ] Move `generateResponse()` (llm.ts lines 2017-2197)
- [ ] Replace `handleToolCall()` if-else with `toolHandlers.get(name)()`
- [ ] Re-export types for external consumers

### Step 14: Update imports
- [ ] Update `src/routes/sms.ts` to import from `./llm/index.js`
- [ ] Update `src/services/scheduler/executor.ts` to import from `../llm/index.js`
- [ ] Update `tests/integration/llm.test.ts` import path from `../../src/llm.js` to `../../src/llm/index.js`

### Step 15: Delete old file
- [ ] Delete `src/llm.ts`

### Step 16: Verify
- [ ] Run `npm run build` - TypeScript compiles without errors
- [ ] Run `npm test` - All existing tests pass
- [ ] Manual test via SMS (if possible)

---

## Files to Modify

| Current File | Action |
|-------------|--------|
| `src/llm.ts` | Delete after migration |
| `src/routes/sms.ts` | Update import path |
| `src/services/scheduler/executor.ts` | Update import path |
| `tests/integration/llm.test.ts` | Update import path (logic unchanged) |

---

## Benefits

1. **Smaller files** - ~200-400 lines each instead of 2,197
2. **Tools organized by domain** - Easy to find calendar tools in calendar.ts
3. **No if-else cascade** - Map lookup replaces 1,130 lines
4. **Testable** - Each domain file can be tested independently
5. **Adding tools** - Add to domain file + register in index.ts

---

## Verification

1. Run `npm run build` - TypeScript compiles
2. Run `npm test` - Existing tests pass
3. Manual test via SMS:
   - "What's on my calendar today?"
   - "Remember my favorite color is blue"
   - "Show me my recent emails"
