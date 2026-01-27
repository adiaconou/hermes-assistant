/**
 * Unit tests for Google Calendar service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setMockEvents,
  clearMockState,
  setShouldFailRefresh,
  getLastPatchedEvent,
  getLastDeletedEventId,
  type MockCalendarEvent
} from '../mocks/google-calendar.js';
import {
  getCredentialStore,
  resetCredentialStore
} from '../../src/services/credentials/index.js';

// Import after mocks are set up
import { listEvents, createEvent, updateEvent, deleteEvent, AuthRequiredError } from '../../src/services/google/calendar.js';

describe('Calendar Service', () => {
  const testPhone = '+1234567890';
  const validCredential = {
    accessToken: 'valid-access-token',
    refreshToken: 'valid-refresh-token',
    expiresAt: Date.now() + 3600000, // 1 hour from now
  };

  beforeEach(() => {
    clearMockState();
    resetCredentialStore();
    vi.clearAllMocks();
  });

  it('lists events for authenticated user', async () => {
    // Store credentials
    const store = getCredentialStore();
    await store.set(testPhone, 'google', validCredential);

    // Set up mock events
    const mockEvents: MockCalendarEvent[] = [
      {
        id: 'event1',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-20T10:00:00Z' },
        end: { dateTime: '2025-01-20T11:00:00Z' },
        location: 'Conference Room A',
      },
      {
        id: 'event2',
        summary: 'Lunch',
        start: { dateTime: '2025-01-20T12:00:00Z' },
        end: { dateTime: '2025-01-20T13:00:00Z' },
      },
    ];
    setMockEvents(mockEvents);

    // Call listEvents
    const events = await listEvents(
      testPhone,
      new Date('2025-01-20T00:00:00Z'),
      new Date('2025-01-20T23:59:59Z')
    );

    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('Team Meeting');
    expect(events[0].location).toBe('Conference Room A');
    expect(events[1].title).toBe('Lunch');
  });

  it('throws AuthRequiredError when no credentials', async () => {
    // No credentials stored
    await expect(
      listEvents(
        testPhone,
        new Date('2025-01-20T00:00:00Z'),
        new Date('2025-01-20T23:59:59Z')
      )
    ).rejects.toThrow(AuthRequiredError);
  });

  it('refreshes expired token before API call', async () => {
    // Store expired credentials
    const store = getCredentialStore();
    const expiredCredential = {
      ...validCredential,
      expiresAt: Date.now() - 1000, // Already expired
    };
    await store.set(testPhone, 'google', expiredCredential);

    setMockEvents([]);

    // Call should succeed (token gets refreshed)
    const events = await listEvents(
      testPhone,
      new Date('2025-01-20T00:00:00Z'),
      new Date('2025-01-20T23:59:59Z')
    );

    expect(events).toHaveLength(0);

    // Verify credentials were updated with new token
    const updatedCreds = await store.get(testPhone, 'google');
    expect(updatedCreds?.accessToken).toBe('new-access-token');
    expect(updatedCreds?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('throws AuthRequiredError when token refresh fails', async () => {
    // Store expired credentials
    const store = getCredentialStore();
    const expiredCredential = {
      ...validCredential,
      expiresAt: Date.now() - 1000, // Already expired
    };
    await store.set(testPhone, 'google', expiredCredential);

    // Make refresh fail (simulates revoked token)
    setShouldFailRefresh(true);

    // Call should throw AuthRequiredError
    await expect(
      listEvents(
        testPhone,
        new Date('2025-01-20T00:00:00Z'),
        new Date('2025-01-20T23:59:59Z')
      )
    ).rejects.toThrow(AuthRequiredError);

    // Credentials should be deleted
    const creds = await store.get(testPhone, 'google');
    expect(creds).toBeNull();
  });

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

      await updateEvent(testPhone, 'event1', { startTime: newStart, endTime: newEnd });

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
});
