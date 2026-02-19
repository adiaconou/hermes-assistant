/**
 * Combined Media Processing
 *
 * Downloads media from Twilio, then runs Drive upload and
 * Gemini pre-analysis in parallel. Returns both results.
 */

import type { MediaAttachment } from '../../tools/types.js';
import type { StoredMediaAttachment, CurrentMediaSummary } from '../conversation/types.js';
import { downloadAllMedia, uploadBuffersToDrive } from './upload.js';
import { preAnalyzeMedia } from './pre-analyze.js';
import type { ImageBufferEntry } from './pre-analyze.js';

/**
 * Result of combined media processing (upload + pre-analysis).
 */
export type MediaProcessingResult = {
  storedMedia: StoredMediaAttachment[];
  preAnalysis: CurrentMediaSummary[];
};

/**
 * Process media attachments: download from Twilio, then run
 * Drive upload and Gemini pre-analysis in parallel.
 *
 * @param phoneNumber User's phone number (for Drive folder)
 * @param attachments Media attachments from Twilio webhook
 * @returns Upload results and pre-analysis summaries
 */
export async function processMediaAttachments(
  phoneNumber: string,
  attachments: MediaAttachment[],
): Promise<MediaProcessingResult> {
  if (!attachments || attachments.length === 0) {
    return { storedMedia: [], preAnalysis: [] };
  }

  // Step 1: Download all media from Twilio (shared buffer pool)
  const downloads = await downloadAllMedia(attachments);

  if (downloads.length === 0) {
    return { storedMedia: [], preAnalysis: [] };
  }

  // Build image buffer entries for pre-analysis
  const imageEntries: ImageBufferEntry[] = downloads.map(d => ({
    buffer: d.buffer,
    mimeType: d.attachment.contentType,
    index: d.attachment.index,
  }));

  // Step 2: Run Drive upload and pre-analysis in parallel
  const [storedMedia, preAnalysis] = await Promise.all([
    uploadBuffersToDrive(phoneNumber, downloads),
    preAnalyzeMedia(imageEntries),
  ]);

  console.log(JSON.stringify({
    level: 'info',
    message: 'Media processing complete',
    uploaded: storedMedia.length,
    preAnalyzed: preAnalysis.length,
    timestamp: new Date().toISOString(),
  }));

  return { storedMedia, preAnalysis };
}
