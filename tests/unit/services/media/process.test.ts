/**
 * Unit tests for combined media processing (upload + pre-analysis).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock upload module
vi.mock('../../../../src/services/media/upload.js', () => ({
  downloadAllMedia: vi.fn(),
  uploadBuffersToDrive: vi.fn(),
}));

// Mock pre-analyze module
vi.mock('../../../../src/services/media/pre-analyze.js', () => ({
  preAnalyzeMedia: vi.fn(),
}));

import { processMediaAttachments } from '../../../../src/services/media/process.js';
import { downloadAllMedia, uploadBuffersToDrive } from '../../../../src/services/media/upload.js';
import { preAnalyzeMedia } from '../../../../src/services/media/pre-analyze.js';
import type { MediaAttachment } from '../../../../src/tools/types.js';

const mockDownload = vi.mocked(downloadAllMedia);
const mockUpload = vi.mocked(uploadBuffersToDrive);
const mockPreAnalyze = vi.mocked(preAnalyzeMedia);

describe('processMediaAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const phone = '+1234567890';

  const attachment: MediaAttachment = {
    url: 'https://api.twilio.com/media/1',
    contentType: 'image/jpeg',
    index: 0,
  };

  it('returns empty results for empty attachments', async () => {
    const result = await processMediaAttachments(phone, []);
    expect(result).toEqual({ storedMedia: [], preAnalysis: [] });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('returns empty results when all downloads fail', async () => {
    mockDownload.mockResolvedValueOnce([]);

    const result = await processMediaAttachments(phone, [attachment]);
    expect(result).toEqual({ storedMedia: [], preAnalysis: [] });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockPreAnalyze).not.toHaveBeenCalled();
  });

  it('runs upload and pre-analysis in parallel after download', async () => {
    const buffer = Buffer.from('image-data');
    mockDownload.mockResolvedValueOnce([{ buffer, attachment }]);
    mockUpload.mockResolvedValueOnce([{
      driveFileId: 'abc123',
      filename: 'image_0.jpg',
      mimeType: 'image/jpeg',
      webViewLink: 'https://drive.google.com/file/d/abc123',
    }]);
    mockPreAnalyze.mockResolvedValueOnce([{
      attachment_index: 0,
      mime_type: 'image/jpeg',
      category: 'receipt' as const,
      summary: 'A grocery receipt.',
    }]);

    const result = await processMediaAttachments(phone, [attachment]);

    expect(result.storedMedia).toHaveLength(1);
    expect(result.storedMedia[0].driveFileId).toBe('abc123');
    expect(result.preAnalysis).toHaveLength(1);
    expect(result.preAnalysis[0].category).toBe('receipt');

    // Both should have been called with the downloaded buffer
    expect(mockUpload).toHaveBeenCalledWith(phone, [{ buffer, attachment }]);
    expect(mockPreAnalyze).toHaveBeenCalledWith([{
      buffer,
      mimeType: 'image/jpeg',
      index: 0,
    }]);
  });

  it('handles upload failure while pre-analysis succeeds', async () => {
    const buffer = Buffer.from('image-data');
    mockDownload.mockResolvedValueOnce([{ buffer, attachment }]);
    mockUpload.mockResolvedValueOnce([]);
    mockPreAnalyze.mockResolvedValueOnce([{
      attachment_index: 0,
      mime_type: 'image/jpeg',
      summary: 'A photo.',
    }]);

    const result = await processMediaAttachments(phone, [attachment]);

    expect(result.storedMedia).toHaveLength(0);
    expect(result.preAnalysis).toHaveLength(1);
  });

  it('handles pre-analysis failure while upload succeeds', async () => {
    const buffer = Buffer.from('image-data');
    mockDownload.mockResolvedValueOnce([{ buffer, attachment }]);
    mockUpload.mockResolvedValueOnce([{
      driveFileId: 'abc123',
      filename: 'image_0.jpg',
      mimeType: 'image/jpeg',
    }]);
    mockPreAnalyze.mockResolvedValueOnce([]);

    const result = await processMediaAttachments(phone, [attachment]);

    expect(result.storedMedia).toHaveLength(1);
    expect(result.preAnalysis).toHaveLength(0);
  });

  it('handles multiple attachments', async () => {
    const attachments: MediaAttachment[] = [
      { url: 'https://api.twilio.com/media/1', contentType: 'image/jpeg', index: 0 },
      { url: 'https://api.twilio.com/media/2', contentType: 'image/png', index: 1 },
    ];
    const buffers = attachments.map((a, i) => ({
      buffer: Buffer.from(`image-${i}`),
      attachment: a,
    }));

    mockDownload.mockResolvedValueOnce(buffers);
    mockUpload.mockResolvedValueOnce([
      { driveFileId: 'id1', filename: 'img_0.jpg', mimeType: 'image/jpeg' },
      { driveFileId: 'id2', filename: 'img_1.png', mimeType: 'image/png' },
    ]);
    mockPreAnalyze.mockResolvedValueOnce([
      { attachment_index: 0, mime_type: 'image/jpeg', summary: 'First' },
      { attachment_index: 1, mime_type: 'image/png', summary: 'Second' },
    ]);

    const result = await processMediaAttachments(phone, attachments);

    expect(result.storedMedia).toHaveLength(2);
    expect(result.preAnalysis).toHaveLength(2);
  });
});
