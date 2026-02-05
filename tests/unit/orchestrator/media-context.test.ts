/**
 * Unit tests for media context formatting.
 */

import { describe, it, expect } from 'vitest';
import { formatMediaContext, hasMediaContext } from '../../../src/orchestrator/media-context.js';
import type { ConversationMessage, ImageAnalysisMetadata } from '../../../src/services/conversation/types.js';

describe('formatMediaContext', () => {
  const createMessage = (
    id: string,
    content: string,
    createdAt: number = Date.now()
  ): ConversationMessage => ({
    id,
    phoneNumber: '+1234567890',
    role: 'user',
    content,
    channel: 'whatsapp',
    createdAt,
    memoryProcessed: false,
  });

  it('returns empty string when metadata map is empty', () => {
    const metadataMap = new Map<string, ImageAnalysisMetadata[]>();
    const history: ConversationMessage[] = [createMessage('msg1', 'Hello')];

    const result = formatMediaContext(metadataMap, history);

    expect(result).toBe('');
  });

  it('formats single image analysis correctly', () => {
    const msg = createMessage('msg1', 'Check this image', Date.now());
    const metadataMap = new Map<string, ImageAnalysisMetadata[]>([
      [
        'msg1',
        [
          {
            driveFileId: 'abc123',
            driveUrl: 'https://drive.google.com/file/d/abc123',
            mimeType: 'image/jpeg',
            analysis: 'A wall calendar showing February 2026',
          },
        ],
      ],
    ]);

    const result = formatMediaContext(metadataMap, [msg]);

    expect(result).toContain('<media_context>');
    expect(result).toContain('</media_context>');
    expect(result).toContain('message_id="msg1"');
    expect(result).toContain('type="image/jpeg"');
    expect(result).toContain('A wall calendar showing February 2026');
  });

  it('escapes XML special characters in analysis', () => {
    const msg = createMessage('msg1', 'Check this');
    const metadataMap = new Map<string, ImageAnalysisMetadata[]>([
      [
        'msg1',
        [
          {
            driveFileId: 'abc123',
            mimeType: 'image/png',
            analysis: 'Text with <script>alert("XSS")</script> and & special chars',
          },
        ],
      ],
    ]);

    const result = formatMediaContext(metadataMap, [msg]);

    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&amp;');
    expect(result).not.toContain('<script>');
  });

  it('truncates very long analysis', () => {
    const msg = createMessage('msg1', 'Check this');
    const longAnalysis = 'A'.repeat(5000); // Exceeds MAX_ANALYSIS_LENGTH of 2000
    const metadataMap = new Map<string, ImageAnalysisMetadata[]>([
      [
        'msg1',
        [
          {
            driveFileId: 'abc123',
            mimeType: 'image/png',
            analysis: longAnalysis,
          },
        ],
      ],
    ]);

    const result = formatMediaContext(metadataMap, [msg]);

    expect(result.length).toBeLessThan(5000);
    expect(result).toContain('...');
  });

  it('orders entries by conversation history order', () => {
    const msg1 = createMessage('msg1', 'First image', Date.now() - 2000);
    const msg2 = createMessage('msg2', 'Second image', Date.now() - 1000);
    const msg3 = createMessage('msg3', 'Third image', Date.now());

    const metadataMap = new Map<string, ImageAnalysisMetadata[]>([
      ['msg3', [{ driveFileId: 'c', mimeType: 'image/png', analysis: 'Third' }]],
      ['msg1', [{ driveFileId: 'a', mimeType: 'image/jpeg', analysis: 'First' }]],
      ['msg2', [{ driveFileId: 'b', mimeType: 'image/gif', analysis: 'Second' }]],
    ]);

    const result = formatMediaContext(metadataMap, [msg1, msg2, msg3]);

    const firstIndex = result.indexOf('First');
    const secondIndex = result.indexOf('Second');
    const thirdIndex = result.indexOf('Third');

    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
  });

  it('handles multiple images per message', () => {
    const msg = createMessage('msg1', 'Multiple images');
    const metadataMap = new Map<string, ImageAnalysisMetadata[]>([
      [
        'msg1',
        [
          { driveFileId: 'a', mimeType: 'image/jpeg', analysis: 'First image' },
          { driveFileId: 'b', mimeType: 'image/png', analysis: 'Second image' },
        ],
      ],
    ]);

    const result = formatMediaContext(metadataMap, [msg]);

    expect(result.match(/<image/g)?.length).toBe(2);
    expect(result).toContain('First image');
    expect(result).toContain('Second image');
  });

  it('skips messages without metadata', () => {
    const msg1 = createMessage('msg1', 'Has image');
    const msg2 = createMessage('msg2', 'No image');
    const msg3 = createMessage('msg3', 'Also has image');

    const metadataMap = new Map<string, ImageAnalysisMetadata[]>([
      ['msg1', [{ driveFileId: 'a', mimeType: 'image/jpeg', analysis: 'Analysis 1' }]],
      ['msg3', [{ driveFileId: 'c', mimeType: 'image/png', analysis: 'Analysis 3' }]],
    ]);

    const result = formatMediaContext(metadataMap, [msg1, msg2, msg3]);

    expect(result.match(/<image/g)?.length).toBe(2);
    expect(result).not.toContain('msg2');
  });
});

describe('hasMediaContext', () => {
  it('returns false for undefined', () => {
    expect(hasMediaContext(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasMediaContext('')).toBe(false);
  });

  it('returns true for non-empty string', () => {
    expect(hasMediaContext('<media_context>...</media_context>')).toBe(true);
  });
});
