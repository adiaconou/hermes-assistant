/**
 * @fileoverview Google Sheets service.
 *
 * Provides Sheets operations with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { google, sheets_v4 } from 'googleapis';
import config from '../../config.js';
import { getCredentialStore } from '../credentials/index.js';
import { AuthRequiredError } from './calendar.js';
import { getOrCreateHermesFolder, moveToHermesFolder } from './drive.js';

/**
 * Spreadsheet returned by our API.
 */
export interface Spreadsheet {
  id: string;
  title: string;
  url: string;
}

/**
 * Cell range data.
 */
export interface CellRange {
  range: string;
  values: (string | number | boolean | null)[][];
}

/**
 * Update result.
 */
export interface UpdateResult {
  updatedCells: number;
  updatedRows: number;
  updatedColumns: number;
}

/**
 * Append result.
 */
export interface AppendResult {
  updatedRange: string;
  updatedRows: number;
}

/**
 * Retry configuration for Google API calls.
 */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Check if an error is retryable (429 or 5xx).
 */
function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: number }).code;
    return code === 429 || (code >= 500 && code < 600);
  }
  return false;
}

/**
 * Check if an error is due to insufficient OAuth scopes.
 * This happens when user authenticated before Sheets scopes were added.
 */
function isInsufficientScopesError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('insufficient authentication scopes') ||
         message.includes('Insufficient Permission');
}

/**
 * Handle Sheets API errors, converting scope errors to AuthRequiredError.
 * Deletes credentials if scopes are insufficient so user can re-auth.
 */
async function handleSheetsApiError(
  error: unknown,
  phoneNumber: string
): Promise<never> {
  if (isInsufficientScopesError(error)) {
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Sheets scope missing, removing credentials for re-auth',
      phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }));

    // Delete credentials so user can re-authenticate with Sheets scopes
    const store = getCredentialStore();
    await store.delete(phoneNumber, 'google');

    throw new AuthRequiredError(phoneNumber);
  }

  // Re-throw other errors as-is
  throw error;
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and optional scope error handling.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  phoneNumber?: string
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Check for scope errors immediately (don't retry these)
      if (phoneNumber && isInsufficientScopesError(error)) {
        await handleSheetsApiError(error, phoneNumber);
      }

      lastError = error;
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        console.log(JSON.stringify({
          level: 'warn',
          message: 'Retrying Google Sheets API call',
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

/**
 * Create an OAuth2 client with stored credentials.
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Refresh an expired access token using the refresh token.
 */
async function refreshAccessToken(
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
 * Get an authenticated Sheets client for a phone number.
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getSheetsClient(
  phoneNumber: string
): Promise<sheets_v4.Sheets> {
  const store = getCredentialStore();
  let creds = await store.get(phoneNumber, 'google');

  if (!creds) {
    throw new AuthRequiredError(phoneNumber);
  }

  // Refresh if token expires in < 5 minutes
  const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
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
        message: 'Refreshed Google access token for Sheets',
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
      throw new AuthRequiredError(phoneNumber);
    }
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: creds.accessToken });

  return google.sheets({ version: 'v4', auth: oauth2Client });
}

/**
 * Create a new spreadsheet.
 *
 * @param phoneNumber - User's phone number
 * @param title - Spreadsheet title
 * @param folderId - Optional folder ID to move the spreadsheet to
 * @returns Created spreadsheet
 * @throws AuthRequiredError if not authenticated
 */
export async function createSpreadsheet(
  phoneNumber: string,
  title: string,
  folderId?: string
): Promise<Spreadsheet> {
  const sheets = await getSheetsClient(phoneNumber);

  const response = await withRetry(() =>
    sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
      },
    }), phoneNumber
  );

  const spreadsheetId = response.data.spreadsheetId!;
  const spreadsheetUrl = response.data.spreadsheetUrl!;

  // Move to Hermes folder if folderId provided, otherwise default to Hermes
  const targetFolder = folderId || await getOrCreateHermesFolder(phoneNumber);
  await moveToHermesFolder(phoneNumber, spreadsheetId, targetFolder);

  console.log(JSON.stringify({
    level: 'info',
    message: 'Created spreadsheet',
    spreadsheetId,
    title,
    timestamp: new Date().toISOString(),
  }));

  return {
    id: spreadsheetId,
    title,
    url: spreadsheetUrl,
  };
}

/**
 * Read a range of cells from a spreadsheet.
 *
 * @param phoneNumber - User's phone number
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation range (e.g., "Sheet1!A1:D10")
 * @returns Cell range data
 * @throws AuthRequiredError if not authenticated
 */
export async function readRange(
  phoneNumber: string,
  spreadsheetId: string,
  range: string
): Promise<CellRange> {
  const sheets = await getSheetsClient(phoneNumber);

  const response = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    }), phoneNumber
  );

  return {
    range: response.data.range || range,
    values: (response.data.values || []) as (string | number | boolean | null)[][],
  };
}

/**
 * Write to a specific range of cells.
 *
 * @param phoneNumber - User's phone number
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation range (e.g., "Sheet1!A1:D10")
 * @param values - 2D array of values to write
 * @returns Update result
 * @throws AuthRequiredError if not authenticated
 */
export async function writeRange(
  phoneNumber: string,
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][]
): Promise<UpdateResult> {
  const sheets = await getSheetsClient(phoneNumber);

  const response = await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    }), phoneNumber
  );

  console.log(JSON.stringify({
    level: 'info',
    message: 'Wrote to spreadsheet',
    spreadsheetId,
    range,
    updatedCells: response.data.updatedCells,
    timestamp: new Date().toISOString(),
  }));

  return {
    updatedCells: response.data.updatedCells || 0,
    updatedRows: response.data.updatedRows || 0,
    updatedColumns: response.data.updatedColumns || 0,
  };
}

/**
 * Append rows to a spreadsheet.
 *
 * @param phoneNumber - User's phone number
 * @param spreadsheetId - Spreadsheet ID
 * @param range - A1 notation range (e.g., "Sheet1!A:D")
 * @param rows - Array of rows to append
 * @returns Append result
 * @throws AuthRequiredError if not authenticated
 */
export async function appendRows(
  phoneNumber: string,
  spreadsheetId: string,
  range: string,
  rows: (string | number | boolean | null)[][]
): Promise<AppendResult> {
  const sheets = await getSheetsClient(phoneNumber);

  const response = await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    }), phoneNumber
  );

  console.log(JSON.stringify({
    level: 'info',
    message: 'Appended rows to spreadsheet',
    spreadsheetId,
    range,
    updatedRows: response.data.updates?.updatedRows,
    timestamp: new Date().toISOString(),
  }));

  return {
    updatedRange: response.data.updates?.updatedRange || range,
    updatedRows: response.data.updates?.updatedRows || rows.length,
  };
}

/**
 * Find a spreadsheet by title in the Hermes folder.
 *
 * @param phoneNumber - User's phone number
 * @param title - Spreadsheet title to search for
 * @returns Found spreadsheet or null
 * @throws AuthRequiredError if not authenticated
 */
export async function findSpreadsheet(
  phoneNumber: string,
  title: string
): Promise<Spreadsheet | null> {
  // Use Drive search to find spreadsheets
  const { searchFiles } = await import('./drive.js');

  const files = await searchFiles(phoneNumber, {
    name: title,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    inHermesFolder: true,
  });

  if (files.length === 0) {
    return null;
  }

  // Return exact match if found, otherwise first result
  const exactMatch = files.find(f => f.name === title);
  const match = exactMatch || files[0];

  return {
    id: match.id,
    title: match.name,
    url: match.webViewLink || `https://docs.google.com/spreadsheets/d/${match.id}`,
  };
}

/**
 * Get spreadsheet metadata.
 *
 * @param phoneNumber - User's phone number
 * @param spreadsheetId - Spreadsheet ID
 * @returns Spreadsheet metadata
 * @throws AuthRequiredError if not authenticated
 */
export async function getSpreadsheet(
  phoneNumber: string,
  spreadsheetId: string
): Promise<Spreadsheet> {
  const sheets = await getSheetsClient(phoneNumber);

  const response = await withRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'spreadsheetId,properties.title,spreadsheetUrl',
    }), phoneNumber
  );

  return {
    id: response.data.spreadsheetId!,
    title: response.data.properties?.title || '',
    url: response.data.spreadsheetUrl!,
  };
}
