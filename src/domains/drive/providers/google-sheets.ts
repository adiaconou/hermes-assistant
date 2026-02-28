/**
 * @fileoverview Google Sheets service.
 */

import { sheets as sheetsApi, sheets_v4 } from '@googleapis/sheets';
import { getAuthenticatedClient, withRetry, getOrCreateHermesFolder, moveToHermesFolder, searchFiles } from './google-core.js';
import type { Spreadsheet, CellRange, UpdateResult, AppendResult } from '../types.js';

async function getSheetsClient(phoneNumber: string): Promise<sheets_v4.Sheets> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Sheets');
  return sheetsApi({ version: 'v4', auth: oauth2Client });
}

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

  // Boundary: require spreadsheetId and URL from API response
  if (!response.data.spreadsheetId || !response.data.spreadsheetUrl) {
    throw new Error('Sheets API returned spreadsheet without required id or url');
  }
  const spreadsheetId = response.data.spreadsheetId;
  const spreadsheetUrl = response.data.spreadsheetUrl;

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

export async function findSpreadsheet(
  phoneNumber: string,
  title: string
): Promise<Spreadsheet | null> {
  const files = await searchFiles(phoneNumber, {
    name: title,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    inHermesFolder: true,
  });

  if (files.length === 0) {
    return null;
  }

  const exactMatch = files.find(f => f.name === title);
  const match = exactMatch || files[0];

  return {
    id: match.id,
    title: match.name,
    url: match.webViewLink || `https://docs.google.com/spreadsheets/d/${match.id}`,
  };
}

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

  // Boundary: require spreadsheetId and URL from API response
  if (!response.data.spreadsheetId || !response.data.spreadsheetUrl) {
    throw new Error(`Sheets API returned spreadsheet without required id or url for spreadsheetId=${spreadsheetId}`);
  }

  return {
    id: response.data.spreadsheetId,
    title: response.data.properties?.title || '',
    url: response.data.spreadsheetUrl,
  };
}
