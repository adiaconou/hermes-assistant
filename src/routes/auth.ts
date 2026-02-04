/**
 * @fileoverview Google OAuth routes for SMS-based authentication.
 *
 * Flow:
 * 1. User asks about calendar via SMS
 * 2. Assistant generates auth URL with encrypted state (phone + expiry)
 * 3. User taps link, redirects to Google consent
 * 4. Google redirects back to /auth/google/callback
 * 5. We store tokens, send confirmation SMS
 */

import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import crypto from 'crypto';
import config from '../config.js';
import { getCredentialStore } from '../services/credentials/index.js';
import { sendSms, sendWhatsApp } from '../twilio.js';
// Legacy generateResponse removed; auth flow response generation will be added later if needed.
import { addMessage } from '../conversation.js';

const router = Router();

// Google API scopes - Calendar, Gmail, and Google Workspace
const SCOPES = [
  // Calendar
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  // Gmail
  'https://www.googleapis.com/auth/gmail.readonly',
  // Drive - discover existing files (read-only) + create/modify app-owned files
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  // Sheets - read/write
  'https://www.googleapis.com/auth/spreadsheets',
  // Docs - read/write
  'https://www.googleapis.com/auth/documents',
];

// State encryption (same key as credentials for simplicity)
const STATE_ALGORITHM = 'aes-256-gcm';
const STATE_IV_LENGTH = 12;
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/** Channel type for message routing */
type MessageChannel = 'sms' | 'whatsapp';

/** OAuth state payload structure */
interface OAuthStatePayload {
  phone: string;
  channel: MessageChannel;
  exp: number;
}

/** Decrypted OAuth state */
interface DecryptedState {
  phone: string;
  channel: MessageChannel;
}

/**
 * Create an OAuth2 client configured with our credentials.
 */
function getOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Encrypt state parameter containing phone number, channel, and expiry.
 * Exported for testing.
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
 * Exported for testing.
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

    // Use Buffer.concat for deterministic encoding (handles multi-byte UTF-8 correctly)
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
      // Fallback to 'sms' for legacy tokens without channel
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
 * Used by calendar tools when auth is required.
 */
export function generateAuthUrl(phoneNumber: string, channel: MessageChannel = 'sms'): string {
  const state = encryptState(phoneNumber, channel);
  return `${config.baseUrl}/auth/google?state=${state}`;
}

/**
 * Continue the conversation after successful OAuth.
 * Triggers the LLM to pick up where it left off.
 */
async function continueAfterAuth(decryptedState: DecryptedState): Promise<void> {
  const { phone, channel } = decryptedState;

  // Notify user to continue; orchestration will pick up on next inbound message
  const response = 'All set! You can ask about your calendar, email, or Google Drive now.';
  await addMessage(phone, 'assistant', response);
  if (channel === 'whatsapp') {
    await sendWhatsApp(phone, response);
  } else {
    await sendSms(phone, response);
  }

  console.log(JSON.stringify({
    level: 'info',
    message: 'Sent post-auth continuation response',
    phone: phone.slice(-4).padStart(phone.length, '*'),
    channel,
    responseLength: response.length,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * GET /auth/google
 * Initiates OAuth flow - redirects to Google consent screen.
 */
export function handleGoogleAuth(req: Request, res: Response): void {
  const state = req.query.state as string | undefined;

  if (!state) {
    res.status(400).send(errorHtml('Missing state parameter'));
    return;
  }

  // Validate state before redirecting (catches expired/invalid early)
  const decrypted = decryptState(state);
  if (!decrypted) {
    res.status(400).send(errorHtml('⏰ Invalid or expired link. Please request a new one.'));
    return;
  }

  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Get refresh token
    scope: SCOPES,
    state: state,
    prompt: 'consent', // Force consent to always get refresh token
  });

  res.redirect(authUrl);
}

router.get('/auth/google', handleGoogleAuth);

/**
 * GET /auth/google/callback
 * Handles OAuth callback from Google.
 */
router.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  // Handle user declining
  if (error) {
    console.log(JSON.stringify({
      level: 'info',
      message: 'User declined OAuth',
      error,
      timestamp: new Date().toISOString(),
    }));
    res.send(errorHtml('👋 Authorization was declined. You can try again anytime by asking about your calendar.'));
    return;
  }

  if (!code || !state) {
    res.status(400).send(errorHtml('Missing code or state parameter'));
    return;
  }

  // Decrypt state to get phone number and channel
  const decrypted = decryptState(state);
  if (!decrypted) {
    res.status(400).send(errorHtml('⏰ Invalid or expired link. Please request a new one.'));
    return;
  }

  try {
    // Exchange code for tokens
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Missing tokens in response');
    }

    // Store credentials (use phone number as key)
    const store = getCredentialStore();
    await store.set(decrypted.phone, 'google', {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date || Date.now() + 3600000,
    });

    console.log(JSON.stringify({
      level: 'info',
      message: 'Google OAuth completed',
      phone: decrypted.phone.slice(-4).padStart(decrypted.phone.length, '*'),
      channel: decrypted.channel,
      timestamp: new Date().toISOString(),
    }));

    // Send success page immediately
    res.send(successHtml(config.twilio.phoneNumber));

    // Continue the conversation asynchronously with preserved channel
    continueAfterAuth(decrypted).catch((error) => {
      console.log(JSON.stringify({
        level: 'error',
        message: 'Failed to continue after OAuth',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }));
    });
  } catch (error) {
    console.log(JSON.stringify({
      level: 'error',
      message: 'OAuth token exchange failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }));
    res.status(500).send(errorHtml('😔 Failed to connect Google account. Please try again.'));
  }
});

/**
 * Format phone number for WhatsApp deep link (wa.me format).
 * Removes 'whatsapp:' prefix, '+' sign, and any non-digit characters.
 */
function formatWhatsAppNumber(phoneNumber: string | undefined): string | null {
  if (!phoneNumber) return null;
  // Remove 'whatsapp:' prefix if present, then strip all non-digits
  return phoneNumber.replace(/^whatsapp:/i, '').replace(/\D/g, '');
}

/**
 * Success page HTML with optional WhatsApp redirect.
 */
function successHtml(botPhoneNumber?: string): string {
  const waNumber = formatWhatsAppNumber(botPhoneNumber);
  const waLink = waNumber ? `https://wa.me/${waNumber}` : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connected!</title>
  ${waLink ? `<meta http-equiv="refresh" content="3;url=${waLink}">` : ''}
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .card {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
      max-width: 400px;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { margin: 0 0 0.5rem; color: #1a1a1a; }
    p { color: #666; margin: 0 0 1rem; }
    .btn {
      display: inline-block;
      background: #25D366;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
      transition: background 0.2s;
    }
    .btn:hover { background: #1da851; }
    .countdown { font-size: 0.85rem; color: #999; margin-top: 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>All Set!</h1>
    <p>✅ Google account is connected.</p>
    ${waLink ? `
    <a href="${waLink}" class="btn">Return to WhatsApp</a>
    <p class="countdown">Redirecting in <span id="seconds">3</span>s...</p>
    <script>
      let s = 3;
      const el = document.getElementById('seconds');
      const timer = setInterval(() => {
        s--;
        if (el) el.textContent = s;
        if (s <= 0) clearInterval(timer);
      }, 1000);
    </script>
    ` : '<p>You can close this page and return to your messages.</p>'}
  </div>
</body>
</html>`;
}

/**
 * Error page HTML.
 */
function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .card {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
      max-width: 400px;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { margin: 0 0 0.5rem; color: #1a1a1a; }
    p { color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Something Went Wrong</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;
