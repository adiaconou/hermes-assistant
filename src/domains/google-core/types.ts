/**
 * @fileoverview Google-core shared type definitions.
 *
 * Types shared across Google service domains (calendar, email, drive, email-watcher).
 */

// Re-export AuthRequiredError from its canonical location for convenience
export { AuthRequiredError } from '../../providers/auth.js';

/** Drive file returned by folder hierarchy operations. */
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

/** Search query options for Drive operations. */
export interface SearchQuery {
  name?: string;
  mimeType?: string;
  inHermesFolder?: boolean;
}
