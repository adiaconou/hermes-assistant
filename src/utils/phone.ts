/**
 * Phone Number Utilities
 *
 * Centralizes phone number normalization and channel detection.
 * All phone numbers in the system should pass through normalize()
 * at the entry point to ensure consistent E.164 format.
 */

export type MessageChannel = 'whatsapp' | 'sms';

/**
 * Detect the messaging channel from a Twilio "From" address.
 * WhatsApp messages arrive with a "whatsapp:" prefix.
 */
export function detectChannel(from: string): MessageChannel {
  return from.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
}

/**
 * Normalize a phone number to E.164 format.
 *
 * Handles:
 * - Stripping "whatsapp:" prefix
 * - Ensuring "+" prefix exists
 * - Removing non-digit characters (except leading +)
 *
 * @param raw Raw phone string from Twilio (e.g. "whatsapp:+15551234567" or "+15551234567")
 * @returns Normalized E.164 string (e.g. "+15551234567")
 */
export function normalize(raw: string): string {
  // Strip whatsapp: prefix
  let phone = raw.replace(/^whatsapp:/i, '');

  // Strip everything except digits and leading +
  phone = phone.replace(/[^\d+]/g, '');

  // Ensure + prefix (Twilio always sends E.164, but guard against edge cases)
  if (!phone.startsWith('+')) {
    phone = `+${phone}`;
  }

  return phone;
}

/**
 * Mask a phone number for safe logging.
 * Shows only the last 4 digits.
 */
export function sanitize(phone: string): string {
  if (phone.length < 4) return '****';
  return '***' + phone.slice(-4);
}

/**
 * Format a phone number for WhatsApp deep links (wa.me format).
 * Returns digits only (no + prefix).
 */
export function formatForWhatsAppLink(phone: string | undefined): string | null {
  if (!phone) return null;
  return normalize(phone).replace(/\D/g, '');
}
