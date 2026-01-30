/**
 * Shared utilities for tool handlers.
 */

import type { ToolContext } from './types.js';
import { AuthRequiredError } from '../services/google/calendar.js';
import { generateAuthUrl } from '../routes/auth.js';
import { isValidTimezone as isValidIanaTimezone } from '../services/date/resolver.js';

/**
 * Require phone number from context, throw if missing.
 */
export function requirePhoneNumber(context: ToolContext): string {
  if (!context.phoneNumber) {
    throw new Error('Phone number not available');
  }
  return context.phoneNumber;
}

/**
 * Handle Google AuthRequiredError consistently.
 * Returns auth result object or null if not an auth error.
 */
export function handleAuthError(
  error: unknown,
  phoneNumber: string,
  channel: 'sms' | 'whatsapp' = 'sms'
): Record<string, unknown> | null {
  if (error instanceof AuthRequiredError) {
    const authUrl = generateAuthUrl(phoneNumber, channel);
    return {
      success: false,
      auth_required: true,
      auth_url: authUrl,
    };
  }
  return null;
}

/**
 * Create a standard error result.
 */
export function errorResult(error: unknown): Record<string, unknown> {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Helper to get end of day for a date.
 */
export function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Validate an IANA timezone string.
 */
export function isValidTimezone(tz: string): boolean {
  return isValidIanaTimezone(tz);
}
