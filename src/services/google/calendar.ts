/**
 * @fileoverview Google Calendar service.
 *
 * Provides listEvents and createEvent functions with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { google, calendar_v3 } from 'googleapis';
import config from '../../config.js';
import { getCredentialStore, type StoredCredential } from '../credentials/index.js';

/**
 * Error thrown when user needs to authenticate with Google.
 */
export class AuthRequiredError extends Error {
  constructor(public phoneNumber: string) {
    super(`Google authentication required for ${phoneNumber}`);
    this.name = 'AuthRequiredError';
  }
}

/**
 * Calendar event returned by our API.
 */
export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO string
  end: string; // ISO string
  location?: string;
}

/**
 * Create an OAuth2 client with stored credentials.
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Refresh an expired access token using the refresh token.
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error('Failed to refresh access token');
  }

  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date || Date.now() + 3600000,
  };
}

/**
 * Get an authenticated Calendar client for a phone number.
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getCalendarClient(
  phoneNumber: string
): Promise<calendar_v3.Calendar> {
  const store = getCredentialStore();
  let creds = await store.get(phoneNumber, 'google');

  if (!creds) {
    throw new AuthRequiredError(phoneNumber);
  }

  // Refresh if token expires in < 5 minutes
  const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
  if (creds.expiresAt < Date.now() + REFRESH_THRESHOLD_MS) {
    try {
      const refreshed = await refreshAccessToken(creds.refreshToken);
      creds = {
        ...creds,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      };
      await store.set(phoneNumber, 'google', creds);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Refreshed Google access token',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      // Refresh failed - token might be revoked
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Token refresh failed, removing credentials',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }));
      await store.delete(phoneNumber, 'google');
      throw new AuthRequiredError(phoneNumber);
    }
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: creds.accessToken });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * List calendar events in a time range.
 *
 * @param phoneNumber - User's phone number
 * @param timeMin - Start of time range
 * @param timeMax - End of time range
 * @returns Array of calendar events
 * @throws AuthRequiredError if not authenticated
 */
export async function listEvents(
  phoneNumber: string,
  timeMin: Date,
  timeMax: Date
): Promise<CalendarEvent[]> {
  const calendar = await getCalendarClient(phoneNumber);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });

  const events = response.data.items || [];

  return events.map((event) => ({
    id: event.id || '',
    title: event.summary || '(No title)',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    location: event.location || undefined,
  }));
}

/**
 * Create a calendar event.
 *
 * @param phoneNumber - User's phone number
 * @param title - Event title
 * @param start - Event start time
 * @param end - Event end time
 * @param location - Optional location
 * @returns Created event
 * @throws AuthRequiredError if not authenticated
 */
export async function createEvent(
  phoneNumber: string,
  title: string,
  start: Date,
  end: Date,
  location?: string
): Promise<CalendarEvent> {
  const calendar = await getCalendarClient(phoneNumber);

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      location: location,
    },
  });

  const event = response.data;

  return {
    id: event.id || '',
    title: event.summary || title,
    start: event.start?.dateTime || '',
    end: event.end?.dateTime || '',
    location: event.location || undefined,
  };
}

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
