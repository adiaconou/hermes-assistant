/**
 * @fileoverview Natural language schedule parser.
 *
 * Converts user-friendly schedule descriptions to either:
 * - Cron expressions for recurring schedules ("daily at 9am" → "0 9 * * *")
 * - Unix timestamps for one-time reminders ("tomorrow at 9am" → 1737500400)
 */

import * as chrono from 'chrono-node';
import { resolveDate } from '../date/resolver.js';

/**
 * Result of parsing a schedule string.
 * Either recurring (cron-based) or one-time (timestamp-based).
 */
export interface ParsedSchedule {
  type: 'recurring' | 'once';
  cronExpression?: string; // For recurring schedules
  runAtTimestamp?: number; // For one-time (Unix seconds)
}

/**
 * Keywords that indicate a recurring schedule.
 */
const RECURRING_KEYWORDS = [
  'daily',
  'every day',
  'every morning',
  'every evening',
  'every night',
  'every weekday',
  'every weekend',
  'every week',
  'weekly',
  'every monday',
  'every tuesday',
  'every wednesday',
  'every thursday',
  'every friday',
  'every saturday',
  'every sunday',
  'every hour',
  'hourly',
  'every minute',
];

/**
 * Check if a schedule string contains recurring keywords.
 */
function isRecurringSchedule(input: string): boolean {
  const normalized = input.toLowerCase().trim();

  // Check string keywords
  if (RECURRING_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }

  // Check "every N minutes/hours" pattern
  if (/every\s+\d+\s*(minute|hour)/i.test(normalized)) {
    return true;
  }

  return false;
}

/**
 * Parse a natural language schedule with auto-detection.
 *
 * Recurring patterns (returns cron):
 * - "daily at 9am", "every day at 9am"
 * - "every Monday at noon"
 * - "every weekday at 8am"
 * - "every 30 minutes"
 *
 * One-time patterns (returns timestamp):
 * - "tomorrow at 9am"
 * - "in 2 hours"
 * - "next Tuesday at 3pm"
 * - "January 15 at 10am"
 *
 * @param input - Natural language schedule
 * @param timezone - IANA timezone for interpreting the time (used for one-time)
 * @returns ParsedSchedule or null if unparseable
 */
export function parseSchedule(input: string, timezone: string): ParsedSchedule | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const normalized = input.toLowerCase().trim();

  // First, check if it's a recurring pattern
  if (isRecurringSchedule(normalized)) {
    const cron = parseScheduleToCron(input);
    if (cron) {
      return { type: 'recurring', cronExpression: cron };
    }
  }

  // Otherwise, try to parse as a one-time reminder
  const timestamp = parseReminderTime(input, timezone);
  if (timestamp) {
    return { type: 'once', runAtTimestamp: timestamp };
  }

  // Final fallback: if it didn't match recurring keywords but might be a cron pattern
  const cron = parseScheduleToCron(input);
  if (cron) {
    return { type: 'recurring', cronExpression: cron };
  }

  return null;
}

/**
 * Parse natural language time into Unix timestamp for one-time reminders.
 *
 * Examples: "tomorrow at 9am", "in 2 hours", "next Tuesday at 3pm"
 *
 * @param input - Natural language time description
 * @param timezone - IANA timezone (e.g., "America/Los_Angeles") for interpreting the time
 * @returns Unix timestamp in seconds, or null if unparseable
 */
export function parseReminderTime(input: string, timezone: string): number | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  try {
    const referenceDate = new Date();
    const result = resolveDate(input, { timezone, referenceDate, forwardDate: true });
    if (!result) {
      return null;
    }

    // One-time reminders must always be in the future.
    const nowSeconds = Math.floor(referenceDate.getTime() / 1000);
    if (result.timestamp <= nowSeconds) {
      return null;
    }

    return result.timestamp;
  } catch {
    return null;
  }
}

/**
 * Day name to cron day number mapping.
 * Cron uses 0=Sunday, 1=Monday, ..., 6=Saturday
 */
const DAY_MAP: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/**
 * Parse a natural language schedule into a cron expression.
 *
 * Supported patterns:
 * - "daily at 9am" → "0 9 * * *"
 * - "every day at 9:30am" → "30 9 * * *"
 * - "every weekday at 8am" → "0 8 * * 1-5"
 * - "every monday at noon" → "0 12 * * 1"
 * - "every hour" → "0 * * * *"
 * - "every 30 minutes" → "*\/30 * * * *"
 *
 * @returns Cron expression string or null if unparseable
 */
export function parseScheduleToCron(schedule: string): string | null {
  if (!schedule || typeof schedule !== 'string') {
    return null;
  }

  const input = schedule.toLowerCase().trim();

  // Pattern: "every X minutes"
  const minutesMatch = input.match(/every\s+(\d+)\s*min(?:ute)?s?/);
  if (minutesMatch) {
    const mins = parseInt(minutesMatch[1], 10);
    if (mins > 0 && mins < 60) {
      return `*/${mins} * * * *`;
    }
  }

  // Pattern: "every minute"
  if (/every\s+minute/.test(input)) {
    return '* * * * *';
  }

  // Pattern: "every hour" or "hourly"
  if (/every\s+hour|^hourly$/.test(input)) {
    return '0 * * * *';
  }

  // Pattern: "every X hours"
  const hoursMatch = input.match(/every\s+(\d+)\s*hours?/);
  if (hoursMatch) {
    const hrs = parseInt(hoursMatch[1], 10);
    if (hrs > 0 && hrs <= 12) {
      return `0 */${hrs} * * *`;
    }
  }

  // Pattern: "every weekday at TIME" or "weekdays at TIME"
  if (/every\s+weekday|weekdays\s+at/.test(input)) {
    const time = extractTime(input);
    if (time) {
      return `${time.minute} ${time.hour} * * 1-5`;
    }
  }

  // Pattern: "every weekend at TIME"
  if (/every\s+weekend|weekends\s+at/.test(input)) {
    const time = extractTime(input);
    if (time) {
      return `${time.minute} ${time.hour} * * 0,6`;
    }
  }

  // Pattern: "every [dayname] at TIME"
  for (const [dayName, dayNum] of Object.entries(DAY_MAP)) {
    const dayPattern = new RegExp(`every\\s+${dayName}(?:s)?\\s+(?:at\\s+)?`, 'i');
    if (dayPattern.test(input)) {
      const time = extractTime(input);
      if (time) {
        return `${time.minute} ${time.hour} * * ${dayNum}`;
      }
    }
  }

  // Pattern: "daily at TIME" or "every day at TIME"
  if (/daily\s+at|every\s+day\s+at/.test(input)) {
    const time = extractTime(input);
    if (time) {
      return `${time.minute} ${time.hour} * * *`;
    }
  }

  // Fallback: try to extract just a time for daily schedule
  // e.g., "at 9am" or "9:30 am"
  const time = extractTime(input);
  if (time && (input.includes('daily') || input.includes('every day'))) {
    return `${time.minute} ${time.hour} * * *`;
  }

  return null;
}

/**
 * Extract time (hour, minute) from a string using chrono-node.
 */
function extractTime(input: string): { hour: number; minute: number } | null {
  // Handle special keywords
  if (input.includes('noon')) {
    return { hour: 12, minute: 0 };
  }
  if (input.includes('midnight')) {
    return { hour: 0, minute: 0 };
  }

  // Use chrono to parse time
  const results = chrono.parse(input, new Date(), { forwardDate: true });
  if (results.length > 0 && results[0].start) {
    const parsed = results[0].start;
    const hour = parsed.get('hour');
    const minute = parsed.get('minute') ?? 0;

    if (hour !== null && hour !== undefined) {
      return { hour, minute };
    }
  }

  // Manual fallback for simple patterns like "9am", "9:30am", "9 am"
  const timeMatch = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3]?.toLowerCase();

    if (meridiem === 'pm' && hour < 12) {
      hour += 12;
    } else if (meridiem === 'am' && hour === 12) {
      hour = 0;
    }

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  return null;
}

/**
 * Validate that a string is a valid cron expression.
 * Basic validation - checks format, not semantic correctness.
 */
export function isValidCron(cron: string): boolean {
  if (!cron || typeof cron !== 'string') {
    return false;
  }

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  // Basic pattern check for each field
  const patterns = [
    /^(\*|(\*\/\d+)|(\d+(-\d+)?)(,\d+(-\d+)?)*)$/, // minute
    /^(\*|(\*\/\d+)|(\d+(-\d+)?)(,\d+(-\d+)?)*)$/, // hour
    /^(\*|(\*\/\d+)|(\d+(-\d+)?)(,\d+(-\d+)?)*)$/, // day of month
    /^(\*|(\*\/\d+)|(\d+(-\d+)?)(,\d+(-\d+)?)*)$/, // month
    /^(\*|(\*\/\d+)|(\d+(-\d+)?)(,\d+(-\d+)?)*)$/, // day of week
  ];

  return parts.every((part, i) => patterns[i].test(part));
}

/**
 * Convert a cron expression to a human-readable description.
 * Used for displaying job schedules to users.
 */
export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return cron;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (cron === '* * * * *') {
    return 'every minute';
  }

  // Every X minutes
  if (minute.startsWith('*/') && hour === '*') {
    return `every ${minute.slice(2)} minutes`;
  }

  // Every hour
  if (minute === '0' && hour === '*') {
    return 'every hour';
  }

  // Every X hours
  if (minute === '0' && hour.startsWith('*/')) {
    return `every ${hour.slice(2)} hours`;
  }

  // Daily at specific time
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `daily at ${formatTime(parseInt(hour, 10), parseInt(minute, 10))}`;
  }

  // Weekdays
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return `weekdays at ${formatTime(parseInt(hour, 10), parseInt(minute, 10))}`;
  }

  // Weekends
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '0,6') {
    return `weekends at ${formatTime(parseInt(hour, 10), parseInt(minute, 10))}`;
  }

  // Specific day of week
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayNum = parseInt(dayOfWeek, 10);
  if (!isNaN(dayNum) && dayNum >= 0 && dayNum <= 6 && dayOfMonth === '*' && month === '*') {
    return `every ${dayNames[dayNum]} at ${formatTime(parseInt(hour, 10), parseInt(minute, 10))}`;
  }

  return cron;
}

/**
 * Format hour and minute as human-readable time.
 */
function formatTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  const ampm = hour < 12 ? 'AM' : 'PM';
  return minute === 0 ? `${h} ${ampm}` : `${h}:${m} ${ampm}`;
}
