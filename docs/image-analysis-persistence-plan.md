# Image Analysis Persistence Plan

## Overview

Enable multi-turn conversations about uploaded images by persisting Gemini's image analysis as **hidden message metadata** in SQLite and injecting it into **agent prompts** on subsequent turns.

**Problem**: When a user uploads an image, Gemini analyzes it on the first turn, but the analysis is lost on subsequent turns. The AI cannot reference image contents in follow-up messages.

**Solution**:
1. Store image analysis as hidden metadata attached to the **user message** that contained the image
2. Fetch that metadata alongside the conversation window and inject it as `<media_context>` into **agent** prompts
3. Keep Drive URL in metadata for re-analysis without exposing it in user-visible chat

---

## User Stories

```
As a user, I can send an image and ask follow-up questions about it without re-uploading.
As a user, I can reference "that calendar" or "the image I sent" in later messages.
As a user, the assistant doesn't dump raw analysis into my chat, but still remembers it.
```

---

## Architecture

### Current Flow (Broken)

```
Turn 1: User sends image
    ↓
Vision tool → Gemini analyzes → returns analysis text
    ↓
AI composes response using analysis
    ↓
Analysis is DISCARDED
    ↓
Turn 2: User asks follow-up → AI has no idea what was in the image
```

### New Flow (Fixed)

```
Turn 1: User sends image
    ↓
Store user message (id = msg_123)
    ↓
Vision tool → Gemini analyzes → store metadata { message_id: msg_123, analysis, drive_url, ... }
    ↓
AI composes response (no raw analysis shown)
    ↓
Turn 2: User asks follow-up
    ↓
Fetch windowed history + metadata for those message_ids
    ↓
Agent prompt: <media_context> injected
    ↓
AI answers using stored analysis without re-analyzing
```

---

## Implementation

### Step 1: Add Message Metadata Storage (SQLite)

**File**: `src/services/conversation/sqlite.ts`

Add a new table to store hidden metadata (not part of user-visible history):

```sql
CREATE TABLE IF NOT EXISTS conversation_message_metadata (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_metadata_message
  ON conversation_message_metadata(message_id);

CREATE INDEX IF NOT EXISTS idx_message_metadata_phone_kind
  ON conversation_message_metadata(phone_number, kind, created_at DESC);
```

Add types and store methods:

```typescript
// src/services/conversation/types.ts
export type MessageMetadataKind = 'image_analysis';

export interface ImageAnalysisMetadata {
  driveFileId: string;
  driveUrl?: string;
  mimeType: string;
  analysis: string;
}
```

```typescript
// src/services/conversation/types.ts
addMessageMetadata(
  messageId: string,
  phoneNumber: string,
  kind: MessageMetadataKind,
  payload: ImageAnalysisMetadata
): Promise<void>;

getMessageMetadata(
  messageIds: string[],
  kind?: MessageMetadataKind
): Promise<Map<string, ImageAnalysisMetadata[]>>;
```

**Why metadata table?**
- Keeps user-visible history clean (no raw analysis)
- Survives restarts and scales across instances
- Opt-in fetch keeps history reads fast

---

### Step 2: Plumb the User Message ID

**Files**: `src/conversation.ts`, `src/routes/sms.ts`, `src/tools/types.ts`, `src/executor/types.ts`

We need the **originating user message ID** so we can attach analysis metadata to it.

```typescript
// src/conversation.ts
// Change addMessage to return the created message (id needed later)
export async function addMessage(...): Promise<ConversationMessage> {
  const store = getConversationStore();
  return store.addMessage(phoneNumber, role, content, channel, mediaAttachments);
}
```

```typescript
// src/routes/sms.ts
// Capture userMessageId and pass to async orchestration
const userMessage = await addMessage(sender, 'user', message, channel);
processAsyncWork(sender, message, channel, userConfig, mediaAttachments, userMessage.id);
```

```typescript
// src/tools/types.ts
export interface ToolContext {
  messageId?: string; // NEW: originating user message id
  ...
}
```

```typescript
// src/executor/types.ts
export interface AgentExecutionContext {
  messageId?: string; // NEW: originating user message id
  ...
}
```

---

### Step 3: Persist Analysis Metadata in Vision Tool

**File**: `src/tools/vision.ts`

After Gemini returns analysis, store metadata attached to the originating user message:

```typescript
const analysis = await analyzeImage(imageBuffer, imageMimeType, prompt);

if (context.messageId && storedItem) {
  await conversationStore.addMessageMetadata(
    context.messageId,
    phoneNumber,
    'image_analysis',
    {
      driveFileId: storedItem.driveFileId,
      driveUrl: storedItem.webViewLink,
      mimeType: imageMimeType,
      analysis,
    }
  );
}
```

---

### Step 4: Inject Media Context into Agent Prompt

**Files**: `src/orchestrator/handler.ts`, agent prompt builder / executor

1. Fetch windowed history as usual.
2. Collect message IDs in the window.
3. Fetch metadata for those IDs.
4. Build a `<media_context>` block and inject into the **agent prompt** (not planner).

```typescript
const messageIds = history.map(m => m.id);
const metadataMap = await conversationStore.getMessageMetadata(messageIds, 'image_analysis');

const formattedMetadata = formatMediaContext(metadataMap, history);
const mediaContextBlock = formattedMetadata
  ? `\n<media_context>\n${formattedMetadata}\n</media_context>`
  : '';
```

**Formatting rules**:
- Escape XML or wrap in JSON to prevent prompt breakage
- Truncate overly long analyses before injection
- Keep ordering aligned with conversation window

---

### Step 5: Logging (Dev Only)

Log full analysis and context in **development only** for debugging.

```typescript
if (process.env.NODE_ENV !== 'production') {
  logger.log('DEBUG', 'Image analysis metadata', {
    analysis,
    mediaContext: formattedMetadata,
  });
}
```

---

## Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `src/services/conversation/sqlite.ts` | Add metadata table + queries | +40 lines |
| `src/services/conversation/types.ts` | Add metadata types + methods | +30 lines |
| `src/conversation.ts` | Return message id from addMessage | +5 lines |
| `src/routes/sms.ts` | Capture userMessageId and pass through | +10 lines |
| `src/tools/vision.ts` | Persist metadata after analysis | +15 lines |
| `src/tools/types.ts` | Add messageId to ToolContext | +5 lines |
| `src/executor/types.ts` | Add messageId to AgentExecutionContext | +5 lines |
| Agent prompt builder | Inject media_context | +20 lines |

**Total**: ~130 lines of new code, small SQLite migration.

---

## Step-by-Step Implementation Checklist

### Phase 1: Add Metadata Storage
- [ ] Add `conversation_message_metadata` table in `src/services/conversation/sqlite.ts`
- [ ] Add metadata types in `src/services/conversation/types.ts`
- [ ] Implement `addMessageMetadata()` and `getMessageMetadata()` in the store

### Phase 2: Plumb Message IDs
- [ ] Update `addMessage()` wrapper to return created message
- [ ] Capture `userMessageId` in `src/routes/sms.ts`
- [ ] Pass `messageId` into async orchestration context
- [ ] Add `messageId` to `ToolContext` and `AgentExecutionContext`

### Phase 3: Persist Analysis Metadata
- [ ] In `src/tools/vision.ts`, after analysis, store metadata keyed to `messageId`
- [ ] Include Drive URL in metadata payload

### Phase 4: Inject Into Agent Prompt
- [ ] Fetch metadata for windowed history message IDs
- [ ] Build `<media_context>` block and inject into agent prompt
- [ ] Escape + truncate analysis before injection

### Phase 5: Logging (Dev Only)
- [ ] Log full analysis + media context in dev logs
- [ ] Ensure production logs do not include analysis

### Phase 6: Testing
- [ ] Unit test: metadata store add/get roundtrip
- [ ] Unit test: media_context formatting + escaping
- [ ] Integration test: multi-turn image conversation uses metadata without re-analysis
- [ ] Manual test: full flow with actual image upload

### Phase 7: Documentation
- [ ] Check if ARCHITECTURE.md needs updating
- [ ] Add inline comments to new code

---

## Testing Strategy

### Unit Tests

```typescript
// src/services/conversation/__tests__/message-metadata.test.ts

describe('message metadata', () => {
  it('stores and retrieves image analysis metadata', async () => {
    await store.addMessageMetadata(messageId, phone, 'image_analysis', {
      driveFileId: 'abc123',
      driveUrl: 'https://drive.google.com/file/d/abc123',
      mimeType: 'image/jpeg',
      analysis: 'A wall calendar showing February 2026',
    });

    const map = await store.getMessageMetadata([messageId], 'image_analysis');
    const items = map.get(messageId) ?? [];
    expect(items[0].analysis).toContain('wall calendar');
  });
});
```

### Manual Testing Flow

1. Start dev server: `npm run dev`
2. Send an image via WhatsApp
3. Send follow-up: "What's on February 14th?"
4. Verify AI references image contents without calling analyze_image again
5. Check dev logs for `<media_context>` injection

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Server restart | Analysis metadata persists in SQLite |
| Multiple images | Metadata attaches to each message; window selects relevant ones |
| Very long analysis | Truncate before prompt injection |
| Non-image media | Not stored (audio/video not analyzed) |

---

## Rollback Plan

If issues arise:
1. Stop writing metadata in `vision.ts`
2. Stop injecting `<media_context>` into agent prompts
3. Leave metadata table in place (harmless), or drop if desired
