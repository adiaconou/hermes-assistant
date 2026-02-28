// Provider-agnostic auth error and link generation.
// Consumed by every domain's tool handlers regardless of provider.

import crypto from 'crypto';
import config from '../config.js';
import { registerOAuthStateNonce } from '../services/auth/oauth-state-nonce.js';

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
  nonce: string;
}

// State encryption constants
const STATE_ALGORITHM = 'aes-256-gcm';
const STATE_IV_LENGTH = 12;
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const STATE_KEY_HEX_LENGTH = 64;

/** Decrypted OAuth state */
export interface DecryptedState {
  phone: string;
  channel: MessageChannel;
  nonce: string;
}

function getStateKeyBuffer(): Buffer | null {
  const key = config.oauth.stateEncryptionKey;
  if (!key || key.length !== STATE_KEY_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(key)) {
    return null;
  }
  const keyBuffer = Buffer.from(key, 'hex');
  return keyBuffer.length === 32 ? keyBuffer : null;
}

/**
 * Encrypt state parameter containing phone number, channel, and expiry.
 */
export function encryptState(phoneNumber: string, channel: MessageChannel = 'sms'): string {
  const keyBuffer = getStateKeyBuffer();
  if (!keyBuffer) {
    throw new Error('OAUTH_STATE_ENCRYPTION_KEY must be a 64-character hex string');
  }

  const payload: OAuthStatePayload = {
    phone: phoneNumber,
    channel,
    exp: Date.now() + STATE_EXPIRY_MS,
    nonce: crypto.randomBytes(16).toString('base64url'),
  };

  const iv = crypto.randomBytes(STATE_IV_LENGTH);
  const cipher = crypto.createCipheriv(STATE_ALGORITHM, keyBuffer, iv);

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Combine iv + authTag + encrypted into URL-safe base64
  const combined = Buffer.concat([iv, authTag, encrypted]);
  registerOAuthStateNonce(payload.nonce, payload.exp);
  return combined.toString('base64url');
}

/**
 * Decrypt and validate state parameter.
 * @returns Decrypted state with phone and channel if valid, null if invalid/expired
 */
export function decryptState(state: string): DecryptedState | null {
  const keyBuffer = getStateKeyBuffer();
  if (!keyBuffer) {
    return null;
  }

  try {
    const combined = Buffer.from(state, 'base64url');
    const iv = combined.subarray(0, STATE_IV_LENGTH);
    const authTag = combined.subarray(STATE_IV_LENGTH, STATE_IV_LENGTH + 16);
    const encrypted = combined.subarray(STATE_IV_LENGTH + 16);

    const decipher = crypto.createDecipheriv(STATE_ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);

    const decryptedBuffer = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    const decrypted = decryptedBuffer.toString('utf8');
    const payload = JSON.parse(decrypted) as OAuthStatePayload;

    if (
      typeof payload.phone !== 'string' ||
      (payload.channel !== 'sms' && payload.channel !== 'whatsapp') ||
      typeof payload.exp !== 'number' ||
      typeof payload.nonce !== 'string' ||
      payload.nonce.length === 0
    ) {
      return null;
    }

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
      nonce: payload.nonce,
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
