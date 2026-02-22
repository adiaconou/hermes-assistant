// Provider-agnostic auth error and link generation.
// Consumed by every domain's tool handlers regardless of provider.

import crypto from 'crypto';
import config from '../config.js';

/**
 * Error thrown when user needs to authenticate with a provider.
 */
export class AuthRequiredError extends Error {
  constructor(public phoneNumber: string) {
    super(`Google authentication required for ${phoneNumber}`);
    this.name = 'AuthRequiredError';
  }
}

/** Channel type for message routing */
type MessageChannel = 'sms' | 'whatsapp';

/** OAuth state payload structure */
interface OAuthStatePayload {
  phone: string;
  channel: MessageChannel;
  exp: number;
}

// State encryption constants
const STATE_ALGORITHM = 'aes-256-gcm';
const STATE_IV_LENGTH = 12;
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/** Decrypted OAuth state */
export interface DecryptedState {
  phone: string;
  channel: MessageChannel;
}

/**
 * Encrypt state parameter containing phone number, channel, and expiry.
 */
export function encryptState(phoneNumber: string, channel: MessageChannel = 'sms'): string {
  const key = config.credentials.encryptionKey;
  if (!key) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY required for OAuth state');
  }

  const payload: OAuthStatePayload = {
    phone: phoneNumber,
    channel,
    exp: Date.now() + STATE_EXPIRY_MS,
  };

  const keyBuffer = Buffer.from(key, 'hex');
  const iv = crypto.randomBytes(STATE_IV_LENGTH);
  const cipher = crypto.createCipheriv(STATE_ALGORITHM, keyBuffer, iv);

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Combine iv + authTag + encrypted into URL-safe base64
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64url');
}

/**
 * Decrypt and validate state parameter.
 * @returns Decrypted state with phone and channel if valid, null if invalid/expired
 */
export function decryptState(state: string): DecryptedState | null {
  const key = config.credentials.encryptionKey;
  if (!key) {
    return null;
  }

  try {
    const combined = Buffer.from(state, 'base64url');
    const iv = combined.subarray(0, STATE_IV_LENGTH);
    const authTag = combined.subarray(STATE_IV_LENGTH, STATE_IV_LENGTH + 16);
    const encrypted = combined.subarray(STATE_IV_LENGTH + 16);

    const keyBuffer = Buffer.from(key, 'hex');
    const decipher = crypto.createDecipheriv(STATE_ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);

    const decryptedBuffer = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    const decrypted = decryptedBuffer.toString('utf8');
    const payload = JSON.parse(decrypted) as OAuthStatePayload;

    // Check expiry
    if (payload.exp < Date.now()) {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'OAuth state expired',
        timestamp: new Date().toISOString(),
      }));
      return null;
    }

    return {
      phone: payload.phone,
      channel: payload.channel || 'sms',
    };
  } catch (error) {
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Failed to decrypt OAuth state',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }));
    return null;
  }
}

/**
 * Generate an auth URL for a phone number and channel.
 * Used by tool handlers when auth is required.
 */
export function generateAuthUrl(phoneNumber: string, channel: MessageChannel = 'sms'): string {
  const state = encryptState(phoneNumber, channel);
  return `${config.baseUrl}/auth/google?state=${state}`;
}
