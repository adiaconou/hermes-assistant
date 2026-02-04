/**
 * @fileoverview Media upload service.
 *
 * Downloads media from Twilio URLs and uploads to Google Drive.
 * Stores files in Hermes/Attachments folder with dated filenames.
 */

import config from '../../config.js';
import { uploadFile, findFolder, createFolder } from '../google/drive.js';
import type { MediaAttachment } from '../../tools/types.js';
import type { StoredMediaAttachment } from '../conversation/types.js';
import { AuthRequiredError } from '../google/calendar.js';

/** Folder name for media attachments */
const ATTACHMENTS_FOLDER = 'Attachments';

/**
 * Get file extension from MIME type.
 */
function getExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/amr': 'amr',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/plain': 'txt',
  };

  return mimeToExt[mimeType] || 'bin';
}

/**
 * Generate a filename with timestamp.
 * Format: YYYY-MM-DD_HHMMSS_<type>_<index>.<ext>
 */
function generateFilename(mimeType: string, index: number): string {
  const now = new Date();
  const datePart = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timePart = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS
  const ext = getExtension(mimeType);

  // Get friendly type name
  const typePart = mimeType.split('/')[0]; // image, video, audio, application

  return `${datePart}_${timePart}_${typePart}_${index}.${ext}`;
}

/**
 * Download media from Twilio URL.
 * Requires Twilio credentials for authentication.
 */
async function downloadFromTwilio(url: string): Promise<Buffer> {
  const { accountSid, authToken } = config.twilio;

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured');
  }

  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get or create the Attachments folder in Hermes.
 */
async function getAttachmentsFolder(phoneNumber: string): Promise<string> {
  // Try to find existing folder
  const existing = await findFolder(phoneNumber, ATTACHMENTS_FOLDER);
  if (existing) {
    return existing.id;
  }

  // Create the folder
  const folder = await createFolder(phoneNumber, ATTACHMENTS_FOLDER);

  console.log(JSON.stringify({
    level: 'info',
    message: 'Created Attachments folder',
    folderId: folder.id,
    timestamp: new Date().toISOString(),
  }));

  return folder.id;
}

/**
 * Upload media attachments to Google Drive.
 *
 * Downloads from Twilio URLs and uploads to the user's
 * Hermes/Attachments folder on Drive.
 *
 * @param phoneNumber - User's phone number
 * @param attachments - Media attachments from Twilio webhook
 * @returns Array of stored attachment records (empty if auth required or upload fails)
 */
export async function uploadMediaAttachments(
  phoneNumber: string,
  attachments: MediaAttachment[]
): Promise<StoredMediaAttachment[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const results: StoredMediaAttachment[] = [];

  try {
    // Get the attachments folder first (will throw AuthRequiredError if not authed)
    const folderId = await getAttachmentsFolder(phoneNumber);

    for (const attachment of attachments) {
      try {
        // Download from Twilio
        const content = await downloadFromTwilio(attachment.url);

        // Generate filename
        const filename = generateFilename(attachment.contentType, attachment.index);

        // Upload to Drive
        const file = await uploadFile(phoneNumber, {
          name: filename,
          mimeType: attachment.contentType,
          content,
          folderId,
        });

        results.push({
          driveFileId: file.id,
          filename: file.name,
          mimeType: attachment.contentType,
          webViewLink: file.webViewLink,
        });

        console.log(JSON.stringify({
          level: 'info',
          message: 'Uploaded media attachment to Drive',
          filename: file.name,
          fileId: file.id,
          mimeType: attachment.contentType,
          size: content.length,
          timestamp: new Date().toISOString(),
        }));
      } catch (error) {
        // Log individual attachment errors but continue with others
        console.log(JSON.stringify({
          level: 'error',
          message: 'Failed to upload media attachment',
          index: attachment.index,
          contentType: attachment.contentType,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        }));

        // Re-throw auth errors
        if (error instanceof AuthRequiredError) {
          throw error;
        }
      }
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      // User not authenticated - return empty array but don't fail
      console.log(JSON.stringify({
        level: 'info',
        message: 'Media upload skipped - user not authenticated with Google',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        attachmentCount: attachments.length,
        timestamp: new Date().toISOString(),
      }));
      return [];
    }

    // Log other errors but don't fail message processing
    console.log(JSON.stringify({
      level: 'error',
      message: 'Media upload failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }));
  }

  return results;
}
