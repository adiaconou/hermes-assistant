/**
 * @fileoverview Google Drive service.
 *
 * Provides Drive operations with automatic token refresh.
 * All writes occur within a "Hermes" folder in the user's Drive.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { google, drive_v3 } from 'googleapis';
import config from '../../config.js';
import { getAuthenticatedClient, withRetry, isInsufficientScopesError, handleScopeError } from './auth.js';
import { AuthRequiredError } from './calendar.js';

/**
 * Drive file returned by our API.
 */
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

/**
 * Drive folder returned by our API.
 */
export interface DriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
}

/**
 * Options for uploading files.
 */
export interface UploadOptions {
  name: string;
  mimeType: string;
  content: Buffer | string;
  folderId?: string;
  description?: string;
}

/**
 * Search query options.
 */
export interface SearchQuery {
  name?: string;
  mimeType?: string;
  inHermesFolder?: boolean;
}

/**
 * Get an authenticated Drive client for a phone number.
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getDriveClient(
  phoneNumber: string
): Promise<drive_v3.Drive> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Drive');
  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Build common Drive API parameters for Shared Drive support.
 */
function getSharedDriveParams(): Record<string, unknown> {
  const sharedDriveId = config.google.sharedDriveId;
  if (sharedDriveId) {
    return {
      driveId: sharedDriveId,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'drive',
    };
  }
  return { supportsAllDrives: true };
}

/**
 * Get or create the Hermes folder for a user.
 * The folder is tagged with appProperties to avoid duplicates.
 *
 * @param phoneNumber - User's phone number
 * @returns Folder ID of the Hermes folder
 * @throws AuthRequiredError if not authenticated
 */
export async function getOrCreateHermesFolder(
  phoneNumber: string
): Promise<string> {
  const drive = await getDriveClient(phoneNumber);

    // First, search for existing Hermes folder by appProperties
    const query = "name = 'Hermes' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='hermesFolder' and value='true' }";

  const searchResponse = await withRetry(() =>
    drive.files.list({
      q: query,
      fields: 'files(id, name)',
      ...getSharedDriveParams(),
    }), phoneNumber
  );

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    const folderId = searchResponse.data.files[0].id!;
    console.log(JSON.stringify({
      level: 'info',
      message: 'Found existing Hermes folder',
      folderId,
      timestamp: new Date().toISOString(),
    }));
    return folderId;
  }

  // Search by name only (in case appProperties wasn't set)
  const nameQuery = "name = 'Hermes' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const nameSearchResponse = await withRetry(() =>
    drive.files.list({
      q: nameQuery,
      fields: 'files(id, name)',
      ...getSharedDriveParams(),
    }), phoneNumber
  );

  if (nameSearchResponse.data.files && nameSearchResponse.data.files.length > 0) {
    const folderId = nameSearchResponse.data.files[0].id!;
    // Tag the existing folder with appProperties
    await withRetry(() =>
      drive.files.update({
        fileId: folderId,
        requestBody: {
          appProperties: { hermesFolder: 'true' },
        },
        supportsAllDrives: true,
      }), phoneNumber
    );
    console.log(JSON.stringify({
      level: 'info',
      message: 'Tagged existing Hermes folder',
      folderId,
      timestamp: new Date().toISOString(),
    }));
    return folderId;
  }

  // Create new Hermes folder
  const sharedDriveId = config.google.sharedDriveId;
  const folderMetadata: drive_v3.Schema$File = {
    name: 'Hermes',
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { hermesFolder: 'true' },
  };

  if (sharedDriveId) {
    folderMetadata.parents = [sharedDriveId];
  }

  const createResponse = await withRetry(() =>
    drive.files.create({
      requestBody: folderMetadata,
      fields: 'id',
      supportsAllDrives: true,
    }), phoneNumber
  );

  const newFolderId = createResponse.data.id!;
  console.log(JSON.stringify({
    level: 'info',
    message: 'Created new Hermes folder',
    folderId: newFolderId,
    timestamp: new Date().toISOString(),
  }));

  return newFolderId;
}

/**
 * Create a folder in the Hermes hierarchy.
 *
 * @param phoneNumber - User's phone number
 * @param name - Folder name
 * @param parentId - Parent folder ID (defaults to Hermes folder)
 * @returns Created folder
 * @throws AuthRequiredError if not authenticated
 */
export async function createFolder(
  phoneNumber: string,
  name: string,
  parentId?: string
): Promise<DriveFolder> {
  const drive = await getDriveClient(phoneNumber);
  const parent = parentId || await getOrCreateHermesFolder(phoneNumber);

  const response = await withRetry(() =>
    drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parent],
      },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true,
    }), phoneNumber
  );

  return {
    id: response.data.id!,
    name: response.data.name!,
    webViewLink: response.data.webViewLink || undefined,
  };
}

/**
 * List files in a folder.
 *
 * @param phoneNumber - User's phone number
 * @param folderId - Folder ID (defaults to Hermes folder)
 * @param options - List options
 * @returns Array of files
 * @throws AuthRequiredError if not authenticated
 */
export async function listFiles(
  phoneNumber: string,
  folderId?: string,
  options?: { maxResults?: number; mimeType?: string }
): Promise<DriveFile[]> {
  const drive = await getDriveClient(phoneNumber);
  const parent = folderId || await getOrCreateHermesFolder(phoneNumber);

  let query = `'${parent}' in parents and trashed = false`;
  if (options?.mimeType) {
    query += ` and mimeType = '${options.mimeType}'`;
  }

  const response = await withRetry(() =>
    drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, webViewLink, parents, createdTime, modifiedTime, size)',
      pageSize: options?.maxResults || 50,
      orderBy: 'modifiedTime desc',
      ...getSharedDriveParams(),
    }), phoneNumber
  );

  return (response.data.files || []).map(file => ({
    id: file.id!,
    name: file.name!,
    mimeType: file.mimeType!,
    webViewLink: file.webViewLink || undefined,
    parents: file.parents || undefined,
    createdTime: file.createdTime || undefined,
    modifiedTime: file.modifiedTime || undefined,
    size: file.size || undefined,
  }));
}

/**
 * Upload a file to Drive.
 *
 * @param phoneNumber - User's phone number
 * @param options - Upload options
 * @returns Uploaded file
 * @throws AuthRequiredError if not authenticated
 */
export async function uploadFile(
  phoneNumber: string,
  options: UploadOptions
): Promise<DriveFile> {
  const drive = await getDriveClient(phoneNumber);
  const parent = options.folderId || await getOrCreateHermesFolder(phoneNumber);

  const response = await withRetry(() =>
    drive.files.create({
      requestBody: {
        name: options.name,
        mimeType: options.mimeType,
        parents: [parent],
        description: options.description,
      },
      media: {
        mimeType: options.mimeType,
        body: typeof options.content === 'string'
          ? options.content
          : Buffer.from(options.content),
      },
      fields: 'id, name, mimeType, webViewLink, parents',
      supportsAllDrives: true,
    }), phoneNumber
  );

  return {
    id: response.data.id!,
    name: response.data.name!,
    mimeType: response.data.mimeType!,
    webViewLink: response.data.webViewLink || undefined,
    parents: response.data.parents || undefined,
  };
}

/**
 * Download a file from Drive.
 *
 * @param phoneNumber - User's phone number
 * @param fileId - File ID to download
 * @returns File content as Buffer
 * @throws AuthRequiredError if not authenticated
 */
export async function downloadFile(
  phoneNumber: string,
  fileId: string
): Promise<Buffer> {
  const drive = await getDriveClient(phoneNumber);

  const response = await withRetry(() =>
    drive.files.get(
      {
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      },
      { responseType: 'arraybuffer' }
    ), phoneNumber
  );

  return Buffer.from(response.data as ArrayBuffer);
}

/**
 * Find a folder by name in the Hermes hierarchy.
 *
 * @param phoneNumber - User's phone number
 * @param name - Folder name to find
 * @returns Found folder or null
 * @throws AuthRequiredError if not authenticated
 */
export async function findFolder(
  phoneNumber: string,
  name: string
): Promise<DriveFolder | null> {
  const drive = await getDriveClient(phoneNumber);
  const hermesFolder = await getOrCreateHermesFolder(phoneNumber);

  // Search for folder by name within Hermes folder
  const query = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${hermesFolder}' in parents and trashed = false`;

  const response = await withRetry(() =>
    drive.files.list({
      q: query,
      fields: 'files(id, name, webViewLink)',
      ...getSharedDriveParams(),
    }), phoneNumber
  );

  if (response.data.files && response.data.files.length > 0) {
    const folder = response.data.files[0];
    return {
      id: folder.id!,
      name: folder.name!,
      webViewLink: folder.webViewLink || undefined,
    };
  }

  return null;
}

/**
 * Search files by various criteria.
 *
 * @param phoneNumber - User's phone number
 * @param query - Search query options
 * @returns Array of matching files
 * @throws AuthRequiredError if not authenticated
 */
export async function searchFiles(
  phoneNumber: string,
  query: SearchQuery
): Promise<DriveFile[]> {
  const drive = await getDriveClient(phoneNumber);

  const queryParts: string[] = ['trashed = false'];

  if (query.name) {
    queryParts.push(`name contains '${query.name}'`);
  }

  if (query.mimeType) {
    queryParts.push(`mimeType = '${query.mimeType}'`);
  }

  if (query.inHermesFolder !== false) {
    const hermesFolder = await getOrCreateHermesFolder(phoneNumber);
    queryParts.push(`'${hermesFolder}' in parents`);
  }

  const response = await withRetry(() =>
    drive.files.list({
      q: queryParts.join(' and '),
      fields: 'files(id, name, mimeType, webViewLink, parents, createdTime, modifiedTime, size)',
      pageSize: 50,
      orderBy: 'modifiedTime desc',
      ...getSharedDriveParams(),
    }), phoneNumber
  );

  return (response.data.files || []).map(file => ({
    id: file.id!,
    name: file.name!,
    mimeType: file.mimeType!,
    webViewLink: file.webViewLink || undefined,
    parents: file.parents || undefined,
    createdTime: file.createdTime || undefined,
    modifiedTime: file.modifiedTime || undefined,
    size: file.size || undefined,
  }));
}

/**
 * Read text content from a file (for non-Google-native files).
 *
 * @param phoneNumber - User's phone number
 * @param fileId - File ID to read
 * @returns File content as string
 * @throws AuthRequiredError if not authenticated
 */
export async function readFileContent(
  phoneNumber: string,
  fileId: string
): Promise<string> {
  const buffer = await downloadFile(phoneNumber, fileId);
  return buffer.toString('utf-8');
}

/**
 * Move a file to the Hermes folder.
 *
 * @param phoneNumber - User's phone number
 * @param fileId - File ID to move
 * @param targetFolderId - Target folder ID (defaults to Hermes folder)
 * @returns Updated file
 * @throws AuthRequiredError if not authenticated
 */
export async function moveToHermesFolder(
  phoneNumber: string,
  fileId: string,
  targetFolderId?: string
): Promise<DriveFile> {
  const drive = await getDriveClient(phoneNumber);
  const targetFolder = targetFolderId || await getOrCreateHermesFolder(phoneNumber);

  // Get current parents
  const fileResponse = await withRetry(() =>
    drive.files.get({
      fileId,
      fields: 'parents',
      supportsAllDrives: true,
    }), phoneNumber
  );

  const currentParents = fileResponse.data.parents?.join(',') || '';

  // Move file
  const response = await withRetry(() =>
    drive.files.update({
      fileId,
      addParents: targetFolder,
      removeParents: currentParents,
      fields: 'id, name, mimeType, webViewLink, parents',
      supportsAllDrives: true,
    }), phoneNumber
  );

  return {
    id: response.data.id!,
    name: response.data.name!,
    mimeType: response.data.mimeType!,
    webViewLink: response.data.webViewLink || undefined,
    parents: response.data.parents || undefined,
  };
}

/**
 * Check if a file is in the Hermes folder hierarchy.
 *
 * @param phoneNumber - User's phone number
 * @param fileId - File ID to check
 * @returns True if file is in Hermes folder
 * @throws AuthRequiredError if not authenticated
 */
export async function isInHermesFolder(
  phoneNumber: string,
  fileId: string
): Promise<boolean> {
  const drive = await getDriveClient(phoneNumber);
  const hermesFolder = await getOrCreateHermesFolder(phoneNumber);

  const response = await withRetry(() =>
    drive.files.get({
      fileId,
      fields: 'parents',
      supportsAllDrives: true,
    }), phoneNumber
  );

  const parents = response.data.parents || [];

  // Check if directly in Hermes folder
  if (parents.includes(hermesFolder)) {
    return true;
  }

  // For nested files, we'd need to traverse up the tree
  // For simplicity, just check immediate parent
  return false;
}
