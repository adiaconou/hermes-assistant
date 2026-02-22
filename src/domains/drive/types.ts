/**
 * @fileoverview Drive domain type definitions.
 */

export { AuthRequiredError } from '../../providers/auth.js';

/** Drive file returned by our API. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  parents?: string[];
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
}

/** Drive folder returned by our API. */
export interface DriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
}

/** Options for uploading files. */
export interface UploadOptions {
  name: string;
  mimeType: string;
  content: Buffer | string;
  folderId?: string;
  description?: string;
}

/** Spreadsheet returned by our API. */
export interface Spreadsheet {
  id: string;
  title: string;
  url: string;
}

/** Cell range data. */
export interface CellRange {
  range: string;
  values: (string | number | boolean | null)[][];
}

/** Update result. */
export interface UpdateResult {
  updatedCells: number;
  updatedRows: number;
  updatedColumns: number;
}

/** Append result. */
export interface AppendResult {
  updatedRange: string;
  updatedRows: number;
}

/** Document returned by our API. */
export interface Document {
  id: string;
  title: string;
  url: string;
}

/** Document content. */
export interface DocumentContent {
  title: string;
  body: string;
}

/** Error thrown when Gemini API is not configured. */
export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('Gemini API key not configured. Set GEMINI_API_KEY environment variable.');
    this.name = 'GeminiNotConfiguredError';
  }
}
