/**
 * Mock for googleapis module (Google Calendar and Gmail).
 *
 * Provides configurable mock responses for testing calendar and email operations
 * without making real API calls.
 */

import { vi } from 'vitest';

/**
 * Mock calendar event structure.
 */
export interface MockCalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
}

/**
 * Mock email structure.
 */
export interface MockEmail {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<{
      mimeType?: string;
      body?: { data?: string };
      parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
    }>;
  };
}

// Calendar mock state
let mockEvents: MockCalendarEvent[] = [];
let listCallCount = 0;
let insertCallCount = 0;
let patchCallCount = 0;
let deleteCallCount = 0;
let lastInsertedEvent: Partial<MockCalendarEvent> | null = null;
let lastPatchedEvent: { eventId: string; requestBody: Partial<MockCalendarEvent> } | null = null;
let lastDeletedEventId: string | null = null;
let shouldFailRefresh = false;

// Gmail mock state
let mockEmails: MockEmail[] = [];
let gmailListCallCount = 0;
let gmailGetCallCount = 0;

/**
 * Set the mock calendar events to return from events.list().
 */
export function setMockEvents(events: MockCalendarEvent[]): void {
  mockEvents = [...events];
}

/**
 * Set the mock emails to return from messages.list() and messages.get().
 */
export function setMockEmails(emails: MockEmail[]): void {
  mockEmails = [...emails];
}

/**
 * Get Gmail call counts for assertions.
 */
export function getGmailCallCounts(): { list: number; get: number } {
  return { list: gmailListCallCount, get: gmailGetCallCount };
}

/**
 * Set whether token refresh should fail.
 */
export function setShouldFailRefresh(fail: boolean): void {
  shouldFailRefresh = fail;
}

/**
 * Get call counts for assertions.
 */
export function getCallCounts(): { list: number; insert: number } {
  return { list: listCallCount, insert: insertCallCount };
}

/**
 * Get the last inserted event.
 */
export function getLastInsertedEvent(): Partial<MockCalendarEvent> | null {
  return lastInsertedEvent;
}

/**
 * Get the last patched event.
 */
export function getLastPatchedEvent(): { eventId: string; requestBody: Partial<MockCalendarEvent> } | null {
  return lastPatchedEvent;
}

/**
 * Get the last deleted event ID.
 */
export function getLastDeletedEventId(): string | null {
  return lastDeletedEventId;
}

/**
 * Clear mock state. Call this in beforeEach.
 */
export function clearMockState(): void {
  // Calendar state
  mockEvents = [];
  listCallCount = 0;
  insertCallCount = 0;
  patchCallCount = 0;
  deleteCallCount = 0;
  lastInsertedEvent = null;
  lastPatchedEvent = null;
  lastDeletedEventId = null;
  shouldFailRefresh = false;
  // Gmail state
  mockEmails = [];
  gmailListCallCount = 0;
  gmailGetCallCount = 0;
}

// Mock calendar.events.list
const mockEventsList = vi.fn(async () => {
  listCallCount++;
  return {
    data: {
      items: mockEvents,
    },
  };
});

// Mock calendar.events.insert
const mockEventsInsert = vi.fn(async (params: { requestBody: Partial<MockCalendarEvent> }) => {
  insertCallCount++;
  const event = params.requestBody;
  lastInsertedEvent = event;
  return {
    data: {
      id: 'new-event-id',
      summary: event.summary,
      start: event.start,
      end: event.end,
      location: event.location,
    },
  };
});

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

// Mock calendar object
const mockCalendar = {
  events: {
    list: mockEventsList,
    insert: mockEventsInsert,
    patch: mockEventsPatch,
    delete: mockEventsDelete,
  },
};

// Mock gmail.users.messages.list
const mockMessagesList = vi.fn(async () => {
  gmailListCallCount++;
  return {
    data: {
      messages: mockEmails.map(e => ({ id: e.id, threadId: e.threadId })),
    },
  };
});

// Mock gmail.users.messages.get
const mockMessagesGet = vi.fn(async (params: { id: string; format?: string }) => {
  gmailGetCallCount++;
  const email = mockEmails.find(e => e.id === params.id);
  if (!email) {
    throw new Error('Email not found');
  }
  return {
    data: email,
  };
});

// Mock gmail object
const mockGmail = {
  users: {
    messages: {
      list: mockMessagesList,
      get: mockMessagesGet,
    },
  },
};

// Mock OAuth2 client
const mockRefreshAccessToken = vi.fn(async () => {
  if (shouldFailRefresh) {
    throw new Error('Token has been revoked');
  }
  return {
    credentials: {
      access_token: 'new-access-token',
      expiry_date: Date.now() + 3600000,
    },
  };
});

const mockSetCredentials = vi.fn();

const mockGenerateAuthUrl = vi.fn((options: { scope: string[]; state?: string }) => {
  return `https://accounts.google.com/o/oauth2/auth?scope=${options.scope.join('+')}&state=${options.state || ''}`;
});

class MockOAuth2 {
  setCredentials = mockSetCredentials;
  refreshAccessToken = mockRefreshAccessToken;
  generateAuthUrl = mockGenerateAuthUrl;
}

// Mock google object
const mockGoogle = {
  auth: {
    OAuth2: MockOAuth2,
  },
  calendar: vi.fn(() => mockCalendar),
  gmail: vi.fn(() => mockGmail),
};

// Set up the module mock
vi.mock('googleapis', () => ({
  google: mockGoogle,
}));

export {
  mockGoogle,
  // Calendar mocks
  mockEventsList,
  mockEventsInsert,
  mockEventsPatch,
  mockEventsDelete,
  // Gmail mocks
  mockMessagesList,
  mockMessagesGet,
  // OAuth mocks
  mockSetCredentials,
  mockRefreshAccessToken,
  mockGenerateAuthUrl,
};
