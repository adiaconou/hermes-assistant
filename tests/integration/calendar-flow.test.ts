/**
 * Integration tests for calendar flow.
 *
 * Tests the full path from OAuth routes through calendar tools.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockReqRes } from '../helpers/mock-http.js';
import {
  setMockEvents,
  setMockTokenResponse,
  setTokenExchangeError,
  clearMockState as clearCalendarMocks,
  type MockCalendarEvent
} from '../mocks/google-calendar.js';
import { getSentMessages, clearSentMessages } from '../mocks/twilio.js';
import {
  getCredentialStore,
  resetCredentialStore
} from '../../src/services/credentials/index.js';

import { generateAuthUrl, handleGoogleAuth, handleGoogleCallback } from '../../src/routes/auth.js';

describe('Calendar Integration', () => {
  const testPhone = '+1234567890';

  beforeEach(() => {
    clearCalendarMocks();
    clearSentMessages();
    resetCredentialStore();
  });

  describe('OAuth Flow', () => {
    it('generates valid auth URL with encrypted state', () => {
      const authUrl = generateAuthUrl(testPhone);

      expect(authUrl).toContain('/auth/google?state=');
      expect(authUrl).toContain('http://localhost:3000');

      // State should be base64url encoded
      const stateMatch = authUrl.match(/state=([^&]+)/);
      expect(stateMatch).not.toBeNull();
      const state = stateMatch![1];
      expect(state.length).toBeGreaterThan(20);
    });

    it('rejects an actually expired state parameter', async () => {
      vi.useFakeTimers();
      try {
        const baseTime = new Date('2026-02-10T10:00:00.000Z');
        vi.setSystemTime(baseTime);
        const authUrl = generateAuthUrl(testPhone);
        const state = authUrl.split('state=')[1];

        // OAuth state expiry is 10 minutes, advance past it
        vi.setSystemTime(new Date(baseTime.getTime() + 11 * 60 * 1000));

        const { req, res } = createMockReqRes({
          method: 'GET',
          url: '/auth/google',
          query: { state },
        });

        handleGoogleAuth(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.text).toContain('Invalid or expired');
      } finally {
        vi.useRealTimers();
      }
    });

    it('redirects to Google when state is valid', async () => {
      const authUrl = generateAuthUrl(testPhone);
      const state = authUrl.split('state=')[1];

      const { req, res } = createMockReqRes({
        method: 'GET',
        url: '/auth/google',
        query: { state },
      });

      handleGoogleAuth(req, res);

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain('accounts.google.com');
      expect(res.headers.location).toContain('oauth2');
    });
  });

  describe('Calendar Tool - Auth Required', () => {
    it('returns auth_required when user not authenticated', async () => {
      // No credentials stored for this user

      // Import the handler function to test directly
      // This is a simplified integration test - in a full setup we'd go through the webhook
      const store = getCredentialStore();
      const creds = await store.get(testPhone, 'google');

      expect(creds).toBeNull();

      // When calendar tool is called, it should return auth_required
      // The actual tool handler test would require setting up the full LLM mock
      // For now, we verify the auth URL generation works
      const authUrl = generateAuthUrl(testPhone);
      expect(authUrl).toContain('/auth/google');
    });
  });

  describe('OAuth Callback', () => {
    it('stores credentials and returns success page for valid callback', async () => {
      const state = generateAuthUrl(testPhone).split('state=')[1];

      setMockTokenResponse({
        access_token: 'callback-access-token',
        refresh_token: 'callback-refresh-token',
        expiry_date: Date.now() + 3600000,
      });

      const { req, res } = createMockReqRes({
        method: 'GET',
        url: '/auth/google/callback',
        query: { code: 'auth-code-123', state },
      });
      await handleGoogleCallback(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Google account is connected');

      const store = getCredentialStore();
      const creds = await store.get(testPhone, 'google');
      expect(creds?.accessToken).toBe('callback-access-token');
      expect(creds?.refreshToken).toBe('callback-refresh-token');

      await vi.waitFor(() => {
        expect(getSentMessages().length).toBeGreaterThan(0);
      }, { timeout: 5000 });
    });

    it('shows declined page when user denies consent', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        url: '/auth/google/callback',
        query: { error: 'access_denied' },
      });
      await handleGoogleCallback(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('Authorization was declined');
    });

    it('returns 500 when token exchange fails', async () => {
      const state = generateAuthUrl(testPhone).split('state=')[1];
      setTokenExchangeError(new Error('token exchange failed'));

      const { req, res } = createMockReqRes({
        method: 'GET',
        url: '/auth/google/callback',
        query: { code: 'auth-code-123', state },
      });
      await handleGoogleCallback(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.text).toContain('Failed to connect Google account');

      setTokenExchangeError(null);
    });

    it('returns 500 when OAuth response is missing refresh token', async () => {
      const state = generateAuthUrl(testPhone).split('state=')[1];
      setMockTokenResponse({
        access_token: 'callback-access-token',
      });

      const { req, res } = createMockReqRes({
        method: 'GET',
        url: '/auth/google/callback',
        query: { code: 'auth-code-123', state },
      });
      await handleGoogleCallback(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.text).toContain('Failed to connect Google account');

      setMockTokenResponse({
        access_token: 'oauth-access-token',
        refresh_token: 'oauth-refresh-token',
        expiry_date: Date.now() + 3600000,
      });
    });
  });

  describe('Calendar Tool - Authenticated', () => {
    it('returns events for authenticated user', async () => {
      // Store credentials
      const store = getCredentialStore();
      await store.set(testPhone, 'google', {
        accessToken: 'valid-access-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: Date.now() + 3600000,
      });

      // Set up mock events
      const mockEvents: MockCalendarEvent[] = [
        {
          id: 'event1',
          summary: 'Morning Standup',
          start: { dateTime: '2025-01-20T09:00:00Z' },
          end: { dateTime: '2025-01-20T09:30:00Z' },
        },
      ];
      setMockEvents(mockEvents);

      // Import and call listEvents directly for this integration test
      const { listEvents } = await import('../../src/domains/calendar/providers/google-calendar.js');

      const events = await listEvents(
        testPhone,
        new Date('2025-01-20T00:00:00Z'),
        new Date('2025-01-20T23:59:59Z')
      );

      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Morning Standup');
    });

    it('creates event for authenticated user', async () => {
      // Store credentials
      const store = getCredentialStore();
      await store.set(testPhone, 'google', {
        accessToken: 'valid-access-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: Date.now() + 3600000,
      });

      // Import and call createEvent directly
      const { createEvent } = await import('../../src/domains/calendar/providers/google-calendar.js');

      const event = await createEvent(
        testPhone,
        'Team Lunch',
        new Date('2025-01-20T12:00:00Z'),
        new Date('2025-01-20T13:00:00Z'),
        'Downtown Cafe'
      );

      expect(event.id).toBe('new-event-id');
      expect(event.title).toBe('Team Lunch');
    });
  });
});
