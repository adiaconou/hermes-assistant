/**
 * @fileoverview Google Sheets service.
 *
 * Provides Sheets operations with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { google, sheets_v4 } from 'googleapis';
import { getAuthenticatedClient, withRetry } from './auth.js';
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
 * Get an authenticated Sheets client for a phone number.
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getSheetsClient(
  phoneNumber: string
): Promise<sheets_v4.Sheets> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Sheets');
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
