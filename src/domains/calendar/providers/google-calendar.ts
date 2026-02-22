/**
 * @fileoverview Google Calendar service.
 *
 * Provides listEvents and createEvent functions with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { calendar as calendarApi, calendar_v3 } from '@googleapis/calendar';
import { getAuthenticatedClient, withRetry } from './google-core.js';

// Re-export AuthRequiredError from canonical location for backward compat
export { AuthRequiredError } from '../../../providers/auth.js';

// Re-export CalendarEvent type from domain types
export type { CalendarEvent } from '../types.js';

/**
 * Get an authenticated Calendar client for a phone number.
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getCalendarClient(
  phoneNumber: string
): Promise<calendar_v3.Calendar> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Calendar');
  return calendarApi({ version: 'v3', auth: oauth2Client });
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
): Promise<import('../types.js').CalendarEvent[]> {
  const calendar = await getCalendarClient(phoneNumber);

  const response = await withRetry(() => calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  }), phoneNumber, 'Calendar');

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
): Promise<import('../types.js').CalendarEvent> {
  const calendar = await getCalendarClient(phoneNumber);

  const response = await withRetry(() => calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      location: location,
    },
  }), phoneNumber, 'Calendar');

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
    startTime?: Date;
    endTime?: Date;
    startDate?: string;
    endDate?: string;
    location?: string;
  }
): Promise<import('../types.js').CalendarEvent> {
  const calendar = await getCalendarClient(phoneNumber);

  // Build request body with only provided fields
  const requestBody: calendar_v3.Schema$Event = {};
  if (updates.title !== undefined) requestBody.summary = updates.title;
  if (updates.startDate !== undefined) requestBody.start = { date: updates.startDate };
  if (updates.endDate !== undefined) requestBody.end = { date: updates.endDate };
  if (updates.startTime !== undefined) requestBody.start = { dateTime: updates.startTime.toISOString() };
  if (updates.endTime !== undefined) requestBody.end = { dateTime: updates.endTime.toISOString() };
  if (updates.location !== undefined) requestBody.location = updates.location;

  const response = await withRetry(() => calendar.events.patch({
    calendarId: 'primary',
    eventId: eventId,
    requestBody,
  }), phoneNumber, 'Calendar');

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
 * Fetch an existing calendar event.
 *
 * @param phoneNumber - User's phone number
 * @param eventId - ID of the event to fetch
 * @returns Event data from Google Calendar
 * @throws AuthRequiredError if not authenticated
 */
export async function getEvent(
  phoneNumber: string,
  eventId: string
): Promise<calendar_v3.Schema$Event> {
  const calendar = await getCalendarClient(phoneNumber);

  const response = await withRetry(() => calendar.events.get({
    calendarId: 'primary',
    eventId: eventId,
  }), phoneNumber, 'Calendar');

  return response.data;
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

  await withRetry(() => calendar.events.delete({
    calendarId: 'primary',
    eventId: eventId,
  }), phoneNumber, 'Calendar');
}
