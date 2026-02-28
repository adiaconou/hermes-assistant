/**
 * Shared utilities for tool handlers.
 */

import type { ToolContext } from './types.js';
import { AuthRequiredError, generateAuthUrl } from '../providers/auth.js';
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

/**
 * Field specification for validateInput.
 */
export interface FieldSpec {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  /** Reject empty/whitespace-only strings. Defaults to true for required strings. */
  nonEmpty?: boolean;
  /** Custom validator returning an error message or null if valid. */
  validate?: (value: unknown) => string | null;
}

/**
 * Validate tool input fields against a specification.
 * Returns an error result object if validation fails, or null if input is valid.
 */
export function validateInput(
  input: Record<string, unknown>,
  spec: Record<string, FieldSpec>
): Record<string, unknown> | null {
  for (const [field, fieldSpec] of Object.entries(spec)) {
    const value = input[field];

    // Check required fields
    if (fieldSpec.required) {
      if (value === undefined || value === null) {
        return { success: false, error: `${field} is required.` };
      }
    } else {
      // Optional field not present — skip further checks
      if (value === undefined || value === null) {
        continue;
      }
    }

    // Type check
    if (fieldSpec.type === 'array') {
      if (!Array.isArray(value)) {
        return { success: false, error: `${field} must be an array.` };
      }
    } else if (fieldSpec.type === 'object') {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { success: false, error: `${field} must be an object.` };
      }
    } else {
      if (typeof value !== fieldSpec.type) {
        return { success: false, error: `${field} must be a ${fieldSpec.type}.` };
      }
    }

    // Non-empty string check
    const nonEmpty = fieldSpec.nonEmpty ?? (fieldSpec.required && fieldSpec.type === 'string');
    if (nonEmpty && fieldSpec.type === 'string' && typeof value === 'string' && !value.trim()) {
      return { success: false, error: `${field} must be a non-empty string.` };
    }

    // Custom validator
    if (fieldSpec.validate) {
      const customError = fieldSpec.validate(value);
      if (customError) {
        return { success: false, error: customError };
      }
    }
  }

  return null;
}
