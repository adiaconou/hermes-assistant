import { describe, it, expect, beforeEach, vi } from 'vitest';

const { MockGeminiNotConfiguredError } = vi.hoisted(() => {
  class MockGeminiNotConfiguredError extends Error {
    constructor(msg?: string) { super(msg); this.name = 'GeminiNotConfiguredError'; }
  }
  return { MockGeminiNotConfiguredError };
});

vi.mock('../../../src/domains/drive/types.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return { ...orig, GeminiNotConfiguredError: MockGeminiNotConfiguredError };
});

vi.mock('../../../src/domains/drive/providers/gemini-vision.js', () => ({
  analyzeImage: vi.fn(),
  isAnalyzableImage: vi.fn(() => true),
}));

vi.mock('../../../src/services/twilio/media.js', () => ({
  downloadTwilioMedia: vi.fn(),
  getMediaErrorMessage: vi.fn(() => 'Sorry, I had trouble downloading that file. Please try again.'),
  isImageType: vi.fn(() => true),
}));

vi.mock('../../../src/domains/drive/providers/google-drive.js', () => ({
  downloadFile: vi.fn(),
}));

const mockConversationStore = {
  addMessageMetadata: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../../src/services/conversation/index.js', () => ({
  getConversationStore: vi.fn(() => mockConversationStore),
}));

import { analyzeImageTool } from '../../../src/domains/drive/runtime/tools.js';
import { analyzeImage } from '../../../src/domains/drive/providers/gemini-vision.js';
import { getConversationStore } from '../../../src/services/conversation/index.js';
import type { ToolContext } from '../../../src/tools/types.js';

describe('vision tool handler', () => {
  const context: ToolContext = {
    phoneNumber: '+15551234567',
    channel: 'sms',
    userConfig: { name: 'Tester', timezone: 'America/New_York' },
    messageId: 'msg_123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationStore.addMessageMetadata.mockResolvedValue(undefined);
  });

  it('analyze_image processes base64 input and stores metadata', async () => {
    const analyzeImageMock = vi.mocked(analyzeImage);
    analyzeImageMock.mockResolvedValueOnce('Detected a receipt with total $12.34');

    const payload = {
      prompt: 'Extract receipt details',
      image_base64: Buffer.from('image-bytes').toString('base64'),
      mime_type: 'image/jpeg',
    };

    const result = await analyzeImageTool.handler(payload, context);

    expect(result).toMatchObject({
      success: true,
      analysis: 'Detected a receipt with total $12.34',
      mimeType: 'image/jpeg',
    });

    expect(getConversationStore).toHaveBeenCalledTimes(1);
    expect(mockConversationStore.addMessageMetadata).toHaveBeenCalledTimes(1);
  });

  it('analyze_image returns configuration message when Gemini is not configured', async () => {
    const analyzeImageMock = vi.mocked(analyzeImage);
    analyzeImageMock.mockRejectedValueOnce(new MockGeminiNotConfiguredError('Missing key'));

    const result = await analyzeImageTool.handler({
      prompt: 'Describe this image',
      image_base64: Buffer.from('image').toString('base64'),
      mime_type: 'image/png',
    }, context);

    expect(result).toEqual({
      success: false,
      error: 'Image analysis is not configured. Please contact support.',
    });
  });

  it('analyze_image returns error when no image source is provided', async () => {
    const result = await analyzeImageTool.handler({
      prompt: 'Describe this image',
    }, context);

    expect(result).toMatchObject({
      success: false,
    });
    expect(String((result as { error?: string }).error)).toContain('No image provided');
  });
});
