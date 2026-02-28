/**
 * @fileoverview Google Drive service.
 */

import { drive as driveApi, drive_v3 } from '@googleapis/drive';
import config from '../../../config.js';
import { getAuthenticatedClient, withRetry, getOrCreateHermesFolder } from './google-core.js';
import type { DriveFile, DriveFolder, UploadOptions } from '../types.js';

async function getDriveClient(phoneNumber: string): Promise<drive_v3.Drive> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Drive');
  return driveApi({ version: 'v3', auth: oauth2Client });
}

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

  // Boundary: require id and name from API response
  if (!response.data.id || !response.data.name) {
    throw new Error('Drive API returned folder without required id or name');
  }

  return {
    id: response.data.id,
    name: response.data.name,
    webViewLink: response.data.webViewLink || undefined,
  };
}

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

  return (response.data.files || [])
    .filter(file => file.id && file.name) // boundary: skip files without required fields
    .map(file => ({
      id: file.id as string, // boundary-ok: filtered above
      name: file.name as string, // boundary-ok: filtered above
      mimeType: file.mimeType || 'application/octet-stream',
      webViewLink: file.webViewLink || undefined,
      parents: file.parents || undefined,
      createdTime: file.createdTime || undefined,
      modifiedTime: file.modifiedTime || undefined,
      size: file.size || undefined,
    }));
}

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

  // Boundary: require id and name from API response
  if (!response.data.id || !response.data.name) {
    throw new Error('Drive API returned uploaded file without required id or name');
  }

  return {
    id: response.data.id,
    name: response.data.name,
    mimeType: response.data.mimeType || options.mimeType,
    webViewLink: response.data.webViewLink || undefined,
    parents: response.data.parents || undefined,
  };
}

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

export async function findFolder(
  phoneNumber: string,
  name: string
): Promise<DriveFolder | null> {
  const drive = await getDriveClient(phoneNumber);
  const hermesFolder = await getOrCreateHermesFolder(phoneNumber);

  // Boundary: escape single quotes in user-provided folder name
  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and '${hermesFolder}' in parents and trashed = false`;

  const response = await withRetry(() =>
    drive.files.list({
      q: query,
      fields: 'files(id, name, webViewLink)',
      ...getSharedDriveParams(),
    }), phoneNumber
  );

  if (response.data.files && response.data.files.length > 0) {
    const folder = response.data.files[0];
    // Boundary: require id and name from API response
    if (!folder.id || !folder.name) {
      return null;
    }
    return {
      id: folder.id,
      name: folder.name,
      webViewLink: folder.webViewLink || undefined,
    };
  }

  return null;
}

export async function readFileContent(
  phoneNumber: string,
  fileId: string
): Promise<string> {
  const buffer = await downloadFile(phoneNumber, fileId);
  return buffer.toString('utf-8');
}

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
  return parents.includes(hermesFolder);
}
