# Plan: User Configuration Store

## Overview

Create a user configuration system that stores per-user preferences (name, timezone, etc.) and prompts new users for missing information on first interaction.

## Goals

1. Store user preferences persistently (name, phone number, timezone)
2. Prompt users for missing required info on first use
3. Inject user context into system prompt for personalized responses
4. Clean, swappable interface (start with SQLite, easy to migrate later)

---

## User Config Schema

```typescript
interface UserConfig {
  phoneNumber: string;      // Primary key - from SMS
  name?: string;            // User's preferred name
  timezone?: string;        // IANA timezone (e.g., "America/Los_Angeles")
  createdAt: number;        // First interaction timestamp
  updatedAt: number;        // Last config update timestamp
}
```

---

## Architecture

### Storage Interface

```typescript
// src/services/user-config/types.ts
interface UserConfigStore {
  get(phoneNumber: string): Promise<UserConfig | null>;
  set(phoneNumber: string, config: Partial<UserConfig>): Promise<void>;
  delete(phoneNumber: string): Promise<void>;
}
```

### Implementations

| Implementation | Use Case | Notes |
|----------------|----------|-------|
| SQLiteUserConfigStore | Default/Production | Uses existing SQLite setup, encrypted at rest |

For tests, mock the `UserConfigStore` interface directly - no separate implementation needed.

### File Structure

```
src/services/user-config/
├── types.ts           # UserConfig interface, UserConfigStore interface
├── sqlite.ts          # SQLite implementation
└── index.ts           # Factory function, exports
```

---

## Integration Points

### 1. SMS Webhook Flow

```
Message Received
       │
       ▼
┌─────────────────────┐
│ Get user config by  │
│ phone number        │
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ New user?           │──Yes──▶ Create minimal record
│ (no config exists)  │         (phoneNumber, createdAt)
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ Check missing       │
│ required fields     │
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ Pass user context   │
│ to LLM (with flags) │
└─────────────────────┘
```

### 2. System Prompt Injection

User context added dynamically to system prompt:

```markdown
## User Context
- Name: {name or "not set"}
- Timezone: {timezone or "not set"}
- Current local time: {time in user's timezone, if known}

{if any fields missing}
**Setup needed:** This user hasn't set up their profile yet.
The following information is missing: {list missing fields}.
Naturally ask for this information in your response. Be conversational,
not robotic. For example:
- "Hey! I don't think we've met - what should I call you?"
- "By the way, what timezone are you in so I can get times right for you?"
{/if}
```

### 3. LLM Tool for Setting User Config

```typescript
{
  name: 'set_user_config',
  description: `Store user preferences. Call this when the user tells you:
    - Their name ("I'm John", "Call me Sarah")
    - Their timezone ("I'm in Pacific time", "EST", "I live in New York")
    - Any other preference update`,
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: "User's preferred name/nickname"
      },
      timezone: {
        type: 'string',
        description: 'IANA timezone identifier (e.g., "America/New_York", "America/Los_Angeles", "Europe/London")'
      }
    }
  }
}
```

---

## Onboarding Flow

### Example: First-Time User

```
User: "What's on my calendar today?"
Assistant: [Sees missing name + timezone in user context]
"Hey! I can check your calendar - but first, what should I call you
and what timezone are you in? That way I get the times right for you."

User: "I'm Mike, Pacific time"
Assistant: [Calls set_user_config tool with {name: "Mike", timezone: "America/Los_Angeles"}]
"Nice to meet you, Mike! Let me check your calendar..."
[Proceeds with calendar lookup using correct timezone]
```

### Example: Returning User

```
User: "Add dentist appointment tomorrow at 2pm"
Assistant: [Has user context: name="Mike", timezone="America/Los_Angeles"]
[Creates event using correct timezone offset]
"Done, Mike! Added dentist appointment for tomorrow (Tuesday) at 2pm PT."
```

---

## Implementation Tasks

### Phase 1: Storage Layer
1. Create `src/services/user-config/types.ts` with interfaces
2. Create `src/services/user-config/sqlite.ts` implementation
3. Create `src/services/user-config/index.ts` factory

### Phase 2: LLM Integration
1. Add `set_user_config` tool to TOOLS array in `llm.ts`
2. Implement tool handler in `handleToolCall()`
3. Update `generateResponse()` to accept and use user config
4. Build dynamic user context section for system prompt

### Phase 3: Webhook Integration
1. Update SMS webhook to fetch user config
2. Pass user config to classification and response generation

### Phase 4: Testing
- Mock `UserConfigStore` interface in tests as needed
- Focus on integration tests for critical flows only

---

## Decisions

1. **Required vs Optional Fields**
   - Prompt naturally but allow usage - don't block functionality

2. **Timezone Validation**
   - Validate timezone strings against IANA timezone database
   - LLM normalizes user input ("Pacific" → "America/Los_Angeles") before calling tool

3. **Data Deletion**
   - Support "forget me" - user can request data deletion
   - Add `delete` method to interface (already defined)

4. **Data Retention**
   - Keep user config permanent (no auto-expiry)

---

## Future Enhancements

- Additional preferences: preferred units (imperial/metric), language
- Notification preferences
- Default calendar (if user has multiple)
- Preferred response style (concise vs detailed)
