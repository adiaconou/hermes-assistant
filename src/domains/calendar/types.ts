/**
 * Calendar domain types.
 */

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
