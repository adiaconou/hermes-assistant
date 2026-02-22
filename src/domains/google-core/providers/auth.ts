/**
 * @fileoverview Shared Google OAuth utilities.
 *
 * Centralizes OAuth2 client creation, token refresh, retry logic, and
 * scope-error handling used by all Google service domains.
 */

import { OAuth2Client } from 'google-auth-library';
import config from '../../../config.js';
import { getCredentialStore } from '../../../services/credentials/index.js';
import { AuthRequiredError } from '../../../providers/auth.js';

/** Token refresh threshold: refresh if expiring within 5 minutes. */
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/** Retry configuration for Google API calls. */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Cache for authenticated OAuth2 clients.
 * Avoids re-creating clients and re-checking token expiry on every API call.
 * Entries are evicted when their token is within the refresh threshold.
 */
const clientCache = new Map<string, { client: OAuth2Client; expiresAt: number }>();

/**
 * Clear the client cache (used by tests to avoid cross-test pollution).
 */
export function clearClientCache(): void {
  clientCache.clear();
}

/**
 * Create a bare OAuth2 client (no credentials set).
 */
export function createOAuth2Client(): OAuth2Client {
  return new OAuth2Client(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(
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
 * Get a valid OAuth2 client for a phone number.
 * Automatically refreshes the token if it's about to expire.
 *
 * @throws AuthRequiredError if no credentials exist or refresh fails
 */
export async function getAuthenticatedClient(
  phoneNumber: string,
  serviceName: string
): Promise<OAuth2Client> {
  // Check cache first — return if token is still valid beyond threshold
  const cached = clientCache.get(phoneNumber);
  if (cached && cached.expiresAt > Date.now() + REFRESH_THRESHOLD_MS) {
    return cached.client;
  }

  const store = getCredentialStore();
  let creds = await store.get(phoneNumber, 'google');

  if (!creds) {
    throw new AuthRequiredError(phoneNumber);
  }

  // Refresh if token expires within threshold
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
        message: `Refreshed Google access token for ${serviceName}`,
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Token refresh failed, removing credentials',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }));
      await store.delete(phoneNumber, 'google');
      clientCache.delete(phoneNumber);
      throw new AuthRequiredError(phoneNumber);
    }
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: creds.accessToken });

  // Cache the authenticated client
  clientCache.set(phoneNumber, { client: oauth2Client, expiresAt: creds.expiresAt });

  return oauth2Client;
}

/**
 * Check if an error is retryable (429 or 5xx).
 */
export function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: number }).code;
    return code === 429 || (code >= 500 && code < 600);
  }
  return false;
}

/**
 * Check if an error is due to insufficient OAuth scopes.
 */
export function isInsufficientScopesError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('insufficient authentication scopes') ||
         message.includes('Insufficient Permission');
}

/**
 * Handle a scope error by deleting credentials and throwing AuthRequiredError.
 */
export async function handleScopeError(
  error: unknown,
  phoneNumber: string,
  serviceName: string
): Promise<never> {
  console.log(JSON.stringify({
    level: 'warn',
    message: `${serviceName} scope missing, removing credentials for re-auth`,
    phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
    error: error instanceof Error ? error.message : 'Unknown error',
    timestamp: new Date().toISOString(),
  }));

  const store = getCredentialStore();
  await store.delete(phoneNumber, 'google');
  clientCache.delete(phoneNumber);
  throw new AuthRequiredError(phoneNumber);
}

/**
 * Sleep for a specified duration (used between retries).
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and scope-error handling.
 *
 * Retries on 429/5xx errors with exponential backoff.
 * Immediately converts scope errors to AuthRequiredError (no retry).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  phoneNumber?: string,
  serviceName = 'Google'
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Scope errors are not retryable
      if (phoneNumber && isInsufficientScopesError(error)) {
        await handleScopeError(error, phoneNumber, serviceName);
      }

      lastError = error;
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        console.log(JSON.stringify({
          level: 'warn',
          message: `Retrying ${serviceName} API call`,
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          timestamp: new Date().toISOString(),
        }));
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}
