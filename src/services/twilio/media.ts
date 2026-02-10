/**
 * @fileoverview Twilio media download service.
 *
 * Downloads media attachments from Twilio using HTTP Basic Auth.
 * Enforces size and type limits for security.
 */

import config from '../../config.js';

/**
 * Allowed non-image media types for processing.
 *
 * All image/* types are allowed to avoid brittle MIME subtype handling
 * across devices/apps (e.g., heic/heif/jpg and content-type parameters).
 */
const ALLOWED_NON_IMAGE_MEDIA_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/**
 * Normalize content types from HTTP headers:
 * - Lowercase
 * - Strip parameters (e.g., "; charset=binary")
 */
function normalizeContentType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

/**
 * Maximum media size in bytes (10 MB).
 */
const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Downloaded media result.
 */
export interface DownloadedMedia {
  buffer: Buffer;
  contentType: string;
  size: number;
}

/**
 * Error thrown when media type is not allowed.
 */
export class UnsupportedMediaTypeError extends Error {
  constructor(public contentType: string) {
    super(`Unsupported media type: ${contentType}. Supported types: image/*, ${ALLOWED_NON_IMAGE_MEDIA_TYPES.join(', ')}`);
    this.name = 'UnsupportedMediaTypeError';
  }
}

/**
 * Error thrown when media is too large.
 */
export class MediaTooLargeError extends Error {
  constructor(public size: number, public maxSize: number) {
    super(`Media too large: ${(size / (1024 * 1024)).toFixed(2)}MB exceeds max of ${(maxSize / (1024 * 1024)).toFixed(2)}MB`);
    this.name = 'MediaTooLargeError';
  }
}

/**
 * Check if a content type is an image.
 */
export function isImageType(contentType: string): boolean {
  return normalizeContentType(contentType).startsWith('image/');
}

/**
 * Check if a content type is allowed.
 */
export function isAllowedMediaType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  if (normalized.startsWith('image/')) {
    return true;
  }
  return ALLOWED_NON_IMAGE_MEDIA_TYPES.includes(normalized);
}

/**
 * Download media from a Twilio media URL.
 *
 * Twilio media URLs require HTTP Basic Auth with account credentials.
 *
 * @param mediaUrl - Twilio media URL
 * @returns Downloaded media with buffer and metadata
 * @throws UnsupportedMediaTypeError if content type is not allowed
 * @throws MediaTooLargeError if media exceeds size limit
 */
export async function downloadTwilioMedia(mediaUrl: string): Promise<DownloadedMedia> {
  const accountSid = config.twilio.accountSid;
  const authToken = config.twilio.authToken;

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured');
  }

  // Create basic auth header
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  console.log(JSON.stringify({
    level: 'info',
    message: 'Downloading Twilio media',
    timestamp: new Date().toISOString(),
  }));

  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }

  const rawContentType = response.headers.get('content-type') || 'application/octet-stream';
  const contentType = normalizeContentType(rawContentType);
  const contentLength = response.headers.get('content-length');

  // Check content type
  if (!isAllowedMediaType(contentType)) {
    throw new UnsupportedMediaTypeError(contentType);
  }

  // Check size from header if available
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (size > MAX_MEDIA_SIZE_BYTES) {
      throw new MediaTooLargeError(size, MAX_MEDIA_SIZE_BYTES);
    }
  }

  // Download the data
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Check actual size
  if (buffer.length > MAX_MEDIA_SIZE_BYTES) {
    throw new MediaTooLargeError(buffer.length, MAX_MEDIA_SIZE_BYTES);
  }

  console.log(JSON.stringify({
    level: 'info',
    message: 'Twilio media downloaded',
    contentType,
    sizeBytes: buffer.length,
    timestamp: new Date().toISOString(),
  }));

  return {
    buffer,
    contentType,
    size: buffer.length,
  };
}

/**
 * Get user-friendly error message for media errors.
 */
export function getMediaErrorMessage(error: unknown): string {
  if (error instanceof UnsupportedMediaTypeError) {
    return `Sorry, I can't process that file type (${error.contentType}). Please send an image, PDF, or Word document.`;
  }

  if (error instanceof MediaTooLargeError) {
    return `Sorry, that file is too large (${(error.size / (1024 * 1024)).toFixed(1)}MB). Please send a file smaller than ${(error.maxSize / (1024 * 1024)).toFixed(0)}MB.`;
  }

  return 'Sorry, I had trouble downloading that file. Please try again.';
}
