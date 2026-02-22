/**
 * @fileoverview Shared Hermes Drive folder hierarchy.
 *
 * Provides the core folder management functions consumed by drive, docs,
 * and sheets domains: getOrCreateHermesFolder, moveToHermesFolder, searchFiles.
 */

import { drive as driveApi, drive_v3 } from '@googleapis/drive';
import config from '../../../config.js';
import { getAuthenticatedClient, withRetry } from '../providers/auth.js';
import type { DriveFile, SearchQuery } from '../types.js';

/**
 * Get an authenticated Drive client for a phone number.
 */
async function getDriveClient(
  phoneNumber: string
): Promise<drive_v3.Drive> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Drive');
  return driveApi({ version: 'v3', auth: oauth2Client });
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
 * Search for files in Drive, optionally scoped to the Hermes folder.
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
