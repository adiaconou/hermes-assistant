/**
 * Unit tests for media pre-analysis service.
 *
 * Tests the pre-analysis pipeline that runs Gemini on image attachments
 * before the planner, producing compact summaries for routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the vision service
vi.mock('../../../../src/services/google/vision.js', () => ({
  analyzeImage: vi.fn(),
  isAnalyzableImage: vi.fn((ct: string) => ct.startsWith('image/')),
  GeminiNotConfiguredError: class GeminiNotConfiguredError extends Error {
    constructor() {
      super('Gemini API key not configured');
      this.name = 'GeminiNotConfiguredError';
    }
  },
}));

// Mock config
vi.mock('../../../../src/config.js', () => ({
  default: {
    mediaFirstPlanning: {
      enabled: true,
      perImageTimeoutMs: 5000,
    },
    google: {
      geminiApiKey: 'test-key',
      geminiModel: 'gemini-2.5-flash',
    },
  },
}));

import { preAnalyzeMedia, type ImageBufferEntry } from '../../../../src/services/media/pre-analyze.js';
import { analyzeImage } from '../../../../src/services/google/vision.js';

const mockAnalyzeImage = vi.mocked(analyzeImage);

describe('preAnalyzeMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createEntry = (index: number, mimeType = 'image/jpeg'): ImageBufferEntry => ({
    buffer: Buffer.from('fake-image-data'),
    mimeType,
    index,
  });

  it('returns empty array for empty input', async () => {
    const result = await preAnalyzeMedia([]);
    expect(result).toEqual([]);
  });

  it('skips non-image entries', async () => {
    const entries: ImageBufferEntry[] = [
      { buffer: Buffer.from('pdf'), mimeType: 'application/pdf', index: 0 },
      { buffer: Buffer.from('doc'), mimeType: 'application/msword', index: 1 },
    ];

    const result = await preAnalyzeMedia(entries);
    expect(result).toEqual([]);
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
  });

  it('returns summary and category for a single image', async () => {
    mockAnalyzeImage.mockResolvedValueOnce(
      '<summary>\nA grocery receipt from Whole Foods showing a total of $47.23.\n</summary>\n<category>receipt</category>'
    );

    const result = await preAnalyzeMedia([createEntry(0)]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      attachment_index: 0,
      mime_type: 'image/jpeg',
      category: 'receipt',
      summary: 'A grocery receipt from Whole Foods showing a total of $47.23.',
    });
  });

  it('handles response without category tag', async () => {
    mockAnalyzeImage.mockResolvedValueOnce(
      '<summary>\nA photo of a sunset over the ocean.\n</summary>'
    );

    const result = await preAnalyzeMedia([createEntry(0)]);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBeUndefined();
    expect(result[0].summary).toBe('A photo of a sunset over the ocean.');
  });

  it('handles response without XML tags (raw text fallback)', async () => {
    mockAnalyzeImage.mockResolvedValueOnce(
      'This is a screenshot of a mobile app showing a login screen.'
    );

    const result = await preAnalyzeMedia([createEntry(0)]);

    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('This is a screenshot of a mobile app showing a login screen.');
    expect(result[0].category).toBeUndefined();
  });

  it('handles invalid category gracefully', async () => {
    mockAnalyzeImage.mockResolvedValueOnce(
      '<summary>\nA random image.\n</summary>\n<category>invalid_cat</category>'
    );

    const result = await preAnalyzeMedia([createEntry(0)]);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBeUndefined();
  });

  it('truncates long summaries to maxSummaryChars', async () => {
    const longText = 'A'.repeat(500);
    mockAnalyzeImage.mockResolvedValueOnce(
      `<summary>\n${longText}\n</summary>\n<category>photo</category>`
    );

    const result = await preAnalyzeMedia([createEntry(0)]);

    expect(result).toHaveLength(1);
    expect(result[0].summary.length).toBeLessThanOrEqual(300);
    expect(result[0].summary).toContain('...');
  });

  it('processes multiple images in parallel', async () => {
    mockAnalyzeImage
      .mockResolvedValueOnce('<summary>\nFirst image.\n</summary>\n<category>photo</category>')
      .mockResolvedValueOnce('<summary>\nSecond image.\n</summary>\n<category>screenshot</category>');

    const entries = [createEntry(0, 'image/jpeg'), createEntry(1, 'image/png')];
    const result = await preAnalyzeMedia(entries);

    expect(result).toHaveLength(2);
    expect(mockAnalyzeImage).toHaveBeenCalledTimes(2);
    expect(result[0].attachment_index).toBe(0);
    expect(result[1].attachment_index).toBe(1);
  });

  it('filters out images from mixed media entries', async () => {
    mockAnalyzeImage.mockResolvedValueOnce(
      '<summary>\nAn image.\n</summary>\n<category>photo</category>'
    );

    const entries: ImageBufferEntry[] = [
      { buffer: Buffer.from('img'), mimeType: 'image/jpeg', index: 0 },
      { buffer: Buffer.from('pdf'), mimeType: 'application/pdf', index: 1 },
    ];

    const result = await preAnalyzeMedia(entries);

    expect(result).toHaveLength(1);
    expect(mockAnalyzeImage).toHaveBeenCalledTimes(1);
  });

  it('continues when individual image analysis fails', async () => {
    mockAnalyzeImage
      .mockRejectedValueOnce(new Error('Gemini error'))
      .mockResolvedValueOnce('<summary>\nSecond worked.\n</summary>\n<category>photo</category>');

    const entries = [createEntry(0), createEntry(1)];
    const result = await preAnalyzeMedia(entries);

    expect(result).toHaveLength(1);
    expect(result[0].attachment_index).toBe(1);
  });

  it('returns empty array when feature is disabled', async () => {
    // Temporarily disable the feature
    const config = await import('../../../../src/config.js');
    const original = config.default.mediaFirstPlanning.enabled;
    config.default.mediaFirstPlanning.enabled = false;

    const result = await preAnalyzeMedia([createEntry(0)]);

    expect(result).toEqual([]);
    expect(mockAnalyzeImage).not.toHaveBeenCalled();

    // Restore
    config.default.mediaFirstPlanning.enabled = original;
  });
});
