# Plan: Add Update and Delete Calendar Event Tools

## Overview

Add `update_calendar_event` and `delete_calendar_event` tools to allow users to modify or remove existing calendar events. Currently only `get_calendar_events` and `create_calendar_event` exist.

## Files to Modify

| File | Changes |
|------|---------|
| `src/services/google/calendar.ts` | Add `updateEvent()` and `deleteEvent()` functions |
| `src/llm.ts` | Add tool definitions and handlers |
| `tests/mocks/google-calendar.ts` | Add mocks for `events.update()` and `events.delete()` |
| `tests/unit/calendar-service.test.ts` | Add tests for new functions |

---

## 1. Calendar Service (`src/services/google/calendar.ts`)

### 1.1 Add `updateEvent()` Function

```typescript
/**
 * Update an existing calendar event.
 *
 * @param phoneNumber - User's phone number
 * @param eventId - ID of the event to update
 * @param updates - Fields to update (all optional)
 * @returns Updated event
 * @throws AuthRequiredError if not authenticated
 */
export async function updateEvent(
  phoneNumber: string,
  eventId: string,
  updates: {
    title?: string;
    start?: Date;
    end?: Date;
    location?: string;
  }
): Promise<CalendarEvent> {
  const calendar = await getCalendarClient(phoneNumber);

  // Build request body with only provided fields
  const requestBody: calendar_v3.Schema$Event = {};
  if (updates.title !== undefined) requestBody.summary = updates.title;
  if (updates.start !== undefined) requestBody.start = { dateTime: updates.start.toISOString() };
  if (updates.end !== undefined) requestBody.end = { dateTime: updates.end.toISOString() };
  if (updates.location !== undefined) requestBody.location = updates.location;

  const response = await calendar.events.patch({
    calendarId: 'primary',
    eventId: eventId,
    requestBody,
  });

  const event = response.data;

  return {
    id: event.id || eventId,
    title: event.summary || '',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    location: event.location || undefined,
  };
}
```

**Note**: Using `patch()` instead of `update()` to allow partial updates (only fields provided will be changed).

### 1.2 Add `deleteEvent()` Function

```typescript
/**
 * Delete a calendar event.
 *
 * @param phoneNumber - User's phone number
 * @param eventId - ID of the event to delete
 * @throws AuthRequiredError if not authenticated
 */
export async function deleteEvent(
  phoneNumber: string,
  eventId: string
): Promise<void> {
  const calendar = await getCalendarClient(phoneNumber);

  await calendar.events.delete({
    calendarId: 'primary',
    eventId: eventId,
  });
}
```

### 1.3 Update Exports

Add to the module exports:
```typescript
export { listEvents, createEvent, updateEvent, deleteEvent, AuthRequiredError };
```

---

## 2. Tool Definitions (`src/llm.ts`)

### 2.1 Add Import

Update the import statement at line 18:
```typescript
import { listEvents, createEvent, updateEvent, deleteEvent, AuthRequiredError } from './services/google/calendar.js';
```

### 2.2 Add `update_calendar_event` Tool Definition

Add after `create_calendar_event` (around line 369):

```typescript
{
  name: 'update_calendar_event',
  description: "Update an existing event on the user's Google Calendar. Use get_calendar_events first to find the event ID.",
  input_schema: {
    type: 'object' as const,
    properties: {
      event_id: {
        type: 'string',
        description: 'The event ID to update (from get_calendar_events)',
      },
      title: {
        type: 'string',
        description: 'New event title (optional)',
      },
      start_time: {
        type: 'string',
        description: 'New start time with timezone offset (optional)',
      },
      end_time: {
        type: 'string',
        description: 'New end time with timezone offset (optional)',
      },
      location: {
        type: 'string',
        description: 'New location (optional)',
      },
    },
    required: ['event_id'],
  },
},
```

### 2.3 Add `delete_calendar_event` Tool Definition

Add after `update_calendar_event`:

```typescript
{
  name: 'delete_calendar_event',
  description: "Delete an event from the user's Google Calendar. Use get_calendar_events first to find the event ID. Ask for confirmation before deleting.",
  input_schema: {
    type: 'object' as const,
    properties: {
      event_id: {
        type: 'string',
        description: 'The event ID to delete (from get_calendar_events)',
      },
    },
    required: ['event_id'],
  },
},
```

---

## 3. Tool Handlers (`src/llm.ts`)

### 3.1 Add `update_calendar_event` Handler

Add after `create_calendar_event` handler (around line 705):

```typescript
if (toolName === 'update_calendar_event') {
  if (!phoneNumber) {
    return JSON.stringify({ success: false, error: 'Phone number not available' });
  }

  const { event_id, title, start_time, end_time, location } = toolInput as {
    event_id: string;
    title?: string;
    start_time?: string;
    end_time?: string;
    location?: string;
  };

  try {
    const updates: {
      title?: string;
      start?: Date;
      end?: Date;
      location?: string;
    } = {};

    if (title !== undefined) updates.title = title;
    if (start_time !== undefined) updates.start = new Date(start_time);
    if (end_time !== undefined) updates.end = new Date(end_time);
    if (location !== undefined) updates.location = location;

    console.log(JSON.stringify({
      level: 'info',
      message: 'Updating calendar event',
      eventId: event_id,
      hasTitle: !!title,
      hasStart: !!start_time,
      hasEnd: !!end_time,
      hasLocation: !!location,
      timestamp: new Date().toISOString(),
    }));

    const event = await updateEvent(phoneNumber, event_id, updates);

    return JSON.stringify({ success: true, event });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      const authUrl = generateAuthUrl(phoneNumber);
      return JSON.stringify({
        success: false,
        auth_required: true,
        auth_url: authUrl,
      });
    }
    console.error(JSON.stringify({
      level: 'error',
      message: 'Calendar event update failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

### 3.2 Add `delete_calendar_event` Handler

Add after `update_calendar_event` handler:

```typescript
if (toolName === 'delete_calendar_event') {
  if (!phoneNumber) {
    return JSON.stringify({ success: false, error: 'Phone number not available' });
  }

  const { event_id } = toolInput as { event_id: string };

  try {
    console.log(JSON.stringify({
      level: 'info',
      message: 'Deleting calendar event',
      eventId: event_id,
      timestamp: new Date().toISOString(),
    }));

    await deleteEvent(phoneNumber, event_id);

    return JSON.stringify({ success: true, deleted: event_id });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      const authUrl = generateAuthUrl(phoneNumber);
      return JSON.stringify({
        success: false,
        auth_required: true,
        auth_url: authUrl,
      });
    }
    console.error(JSON.stringify({
      level: 'error',
      message: 'Calendar event deletion failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

---

## 4. Mocks (`tests/mocks/google-calendar.ts`)

### 4.1 Add State Variables

Add to the mock state section (around line 26):
```typescript
let patchCallCount = 0;
let deleteCallCount = 0;
let lastPatchedEvent: { eventId: string; requestBody: Partial<MockCalendarEvent> } | null = null;
let lastDeletedEventId: string | null = null;
```

### 4.2 Add Mock Functions

Add after `mockEventsInsert`:

```typescript
// Mock calendar.events.patch
const mockEventsPatch = vi.fn(async (params: { eventId: string; requestBody: Partial<MockCalendarEvent> }) => {
  patchCallCount++;
  lastPatchedEvent = params;

  // Find existing event to merge with updates
  const existing = mockEvents.find(e => e.id === params.eventId);

  return {
    data: {
      id: params.eventId,
      summary: params.requestBody.summary ?? existing?.summary ?? '',
      start: params.requestBody.start ?? existing?.start ?? { dateTime: '' },
      end: params.requestBody.end ?? existing?.end ?? { dateTime: '' },
      location: params.requestBody.location ?? existing?.location,
    },
  };
});

// Mock calendar.events.delete
const mockEventsDelete = vi.fn(async (params: { eventId: string }) => {
  deleteCallCount++;
  lastDeletedEventId = params.eventId;
  return { data: {} };
});
```

### 4.3 Update Mock Calendar Object

```typescript
const mockCalendar = {
  events: {
    list: mockEventsList,
    insert: mockEventsInsert,
    patch: mockEventsPatch,
    delete: mockEventsDelete,
  },
};
```

### 4.4 Update Helper Functions

Add to `getCallCounts()`:
```typescript
export function getCallCounts(): { list: number; insert: number; patch: number; delete: number } {
  return { list: listCallCount, insert: insertCallCount, patch: patchCallCount, delete: deleteCallCount };
}
```

Add new helper functions:
```typescript
export function getLastPatchedEvent(): { eventId: string; requestBody: Partial<MockCalendarEvent> } | null {
  return lastPatchedEvent;
}

export function getLastDeletedEventId(): string | null {
  return lastDeletedEventId;
}
```

Update `clearMockState()`:
```typescript
export function clearMockState(): void {
  mockEvents = [];
  listCallCount = 0;
  insertCallCount = 0;
  patchCallCount = 0;
  deleteCallCount = 0;
  lastInsertedEvent = null;
  lastPatchedEvent = null;
  lastDeletedEventId = null;
  shouldFailRefresh = false;
}
```

### 4.5 Update Exports

```typescript
export {
  mockGoogle,
  mockEventsList,
  mockEventsInsert,
  mockEventsPatch,
  mockEventsDelete,
  mockSetCredentials,
  mockRefreshAccessToken,
  mockGenerateAuthUrl
};
```

---

## 5. Tests (`tests/unit/calendar-service.test.ts`)

### 5.1 Update Imports

```typescript
import {
  setMockEvents,
  clearMockState,
  setShouldFailRefresh,
  getLastPatchedEvent,
  getLastDeletedEventId,
  type MockCalendarEvent
} from '../mocks/google-calendar.js';

import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  AuthRequiredError
} from '../../src/services/google/calendar.js';
```

### 5.2 Add Update Event Tests

```typescript
describe('updateEvent', () => {
  it('updates event title', async () => {
    const store = getCredentialStore();
    await store.set(testPhone, 'google', validCredential);

    setMockEvents([{
      id: 'event1',
      summary: 'Old Title',
      start: { dateTime: '2025-01-20T10:00:00Z' },
      end: { dateTime: '2025-01-20T11:00:00Z' },
    }]);

    const result = await updateEvent(testPhone, 'event1', { title: 'New Title' });

    expect(result.title).toBe('New Title');
    const patched = getLastPatchedEvent();
    expect(patched?.eventId).toBe('event1');
    expect(patched?.requestBody.summary).toBe('New Title');
  });

  it('updates event time', async () => {
    const store = getCredentialStore();
    await store.set(testPhone, 'google', validCredential);

    setMockEvents([{
      id: 'event1',
      summary: 'Meeting',
      start: { dateTime: '2025-01-20T10:00:00Z' },
      end: { dateTime: '2025-01-20T11:00:00Z' },
    }]);

    const newStart = new Date('2025-01-20T14:00:00Z');
    const newEnd = new Date('2025-01-20T15:00:00Z');

    const result = await updateEvent(testPhone, 'event1', { start: newStart, end: newEnd });

    const patched = getLastPatchedEvent();
    expect(patched?.requestBody.start?.dateTime).toBe(newStart.toISOString());
    expect(patched?.requestBody.end?.dateTime).toBe(newEnd.toISOString());
  });

  it('throws AuthRequiredError when no credentials', async () => {
    await expect(
      updateEvent(testPhone, 'event1', { title: 'New Title' })
    ).rejects.toThrow(AuthRequiredError);
  });
});
```

### 5.3 Add Delete Event Tests

```typescript
describe('deleteEvent', () => {
  it('deletes event by ID', async () => {
    const store = getCredentialStore();
    await store.set(testPhone, 'google', validCredential);

    await deleteEvent(testPhone, 'event1');

    expect(getLastDeletedEventId()).toBe('event1');
  });

  it('throws AuthRequiredError when no credentials', async () => {
    await expect(
      deleteEvent(testPhone, 'event1')
    ).rejects.toThrow(AuthRequiredError);
  });
});
```

---

## 6. System Prompt Update (`src/llm.ts`)

Update the system prompt section (around line 265) to mention the new capabilities:

```typescript
You can access the user's Google Calendar using get_calendar_events, create_calendar_event, update_calendar_event, and delete_calendar_event tools.
```

---

## 7. Implementation Order

1. **Mocks first** - Add mock functions for `patch` and `delete`
2. **Service layer** - Add `updateEvent()` and `deleteEvent()` to calendar.ts
3. **Tests** - Add unit tests for new functions
4. **Tool definitions** - Add tools to TOOLS array in llm.ts
5. **Tool handlers** - Add handlers in `handleToolCall()`
6. **System prompt** - Update to mention new capabilities
7. **Run tests** - Verify everything works

---

## 8. Google Calendar API Reference

- **Patch** (partial update): `calendar.events.patch({ calendarId, eventId, requestBody })`
- **Delete**: `calendar.events.delete({ calendarId, eventId })`
- Both require `calendar.events` OAuth scope (already configured)

---

## 9. Edge Cases to Consider

1. **Non-existent event ID** - Google API will return 404, which should surface as error message
2. **Empty updates** - Passing no update fields should still succeed (no-op)
3. **Partial time updates** - Updating only start time without end time should work
4. **Location clearing** - Passing empty string for location should clear it

---

## 10. Future Enhancements (Out of Scope)

- Bulk update/delete operations
- Recurring event modification options (this instance vs all instances)
- Event attendee management
- Calendar selection (currently hardcoded to 'primary')
