/**
 * Unit tests for SMS webhook persistence: pre-analysis metadata and
 * updateMediaAttachments backfill in processAsyncWork.
 *
 * Uses the SQLite conversation store directly to verify data is persisted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteConversationStore } from '../../../src/services/conversation/sqlite.js';
import type { StoredMediaAttachment, ImageAnalysisMetadata } from '../../../src/services/conversation/types.js';

describe('SqliteConversationStore.updateMediaAttachments', () => {
  let store: SqliteConversationStore;

  beforeEach(() => {
    store = new SqliteConversationStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('should backfill media attachments on an existing message', async () => {
    // Create a message without media
    const msg = await store.addMessage('+1555000111', 'user', 'Check this', 'whatsapp');
    expect(msg.mediaAttachments).toBeUndefined();

    // Backfill with stored media
    const attachments: StoredMediaAttachment[] = [
      { driveFileId: 'abc', filename: 'img.jpg', mimeType: 'image/jpeg', originalIndex: 0 },
    ];
    await store.updateMediaAttachments(msg.id, attachments);

    // Verify via getHistory
    const history = await store.getHistory('+1555000111');
    const updated = history.find(m => m.id === msg.id);
    expect(updated?.mediaAttachments).toHaveLength(1);
    expect(updated?.mediaAttachments?.[0].driveFileId).toBe('abc');
    expect(updated?.mediaAttachments?.[0].originalIndex).toBe(0);
  });

  it('should set media_attachments to null when empty array is passed', async () => {
    // Create a message with media
    const attachments: StoredMediaAttachment[] = [
      { driveFileId: 'xyz', filename: 'test.png', mimeType: 'image/png' },
    ];
    const msg = await store.addMessage('+1555000222', 'user', 'Image', 'sms', attachments);
    expect(msg.mediaAttachments).toHaveLength(1);

    // Clear media
    await store.updateMediaAttachments(msg.id, []);

    const history = await store.getHistory('+1555000222');
    const updated = history.find(m => m.id === msg.id);
    expect(updated?.mediaAttachments).toBeUndefined();
  });

  it('should overwrite existing media attachments', async () => {
    const original: StoredMediaAttachment[] = [
      { driveFileId: 'old', filename: 'old.jpg', mimeType: 'image/jpeg' },
    ];
    const msg = await store.addMessage('+1555000333', 'user', 'Replace', 'sms', original);

    const newAttachments: StoredMediaAttachment[] = [
      { driveFileId: 'new1', filename: 'new1.jpg', mimeType: 'image/jpeg', originalIndex: 0 },
      { driveFileId: 'new2', filename: 'new2.png', mimeType: 'image/png', originalIndex: 1 },
    ];
    await store.updateMediaAttachments(msg.id, newAttachments);

    const history = await store.getHistory('+1555000333');
    const updated = history.find(m => m.id === msg.id);
    expect(updated?.mediaAttachments).toHaveLength(2);
    expect(updated?.mediaAttachments?.[0].driveFileId).toBe('new1');
    expect(updated?.mediaAttachments?.[1].driveFileId).toBe('new2');
  });
});

describe('Pre-analysis metadata persistence', () => {
  let store: SqliteConversationStore;

  beforeEach(() => {
    store = new SqliteConversationStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('should persist pre-analysis summary as image_analysis metadata', async () => {
    const msg = await store.addMessage('+1555000444', 'user', '[User sent an image]', 'whatsapp');

    // Simulate what processAsyncWork does with pre-analysis
    await store.addMessageMetadata(msg.id, '+1555000444', 'image_analysis', {
      mimeType: 'image/jpeg',
      analysis: 'A grocery receipt from Whole Foods totaling $47.23',
    } satisfies Pick<ImageAnalysisMetadata, 'mimeType' | 'analysis'>);

    const metadata = await store.getMessageMetadata<ImageAnalysisMetadata>([msg.id], 'image_analysis');
    expect(metadata.get(msg.id)).toHaveLength(1);
    expect(metadata.get(msg.id)?.[0].analysis).toContain('Whole Foods');
  });

  it('should allow both pre-analysis and full analysis on same message', async () => {
    const msg = await store.addMessage('+1555000555', 'user', '[User sent an image]', 'sms');

    // Pre-analysis (from processAsyncWork)
    await store.addMessageMetadata(msg.id, '+1555000555', 'image_analysis', {
      mimeType: 'image/jpeg',
      analysis: 'Quick summary: receipt',
    });

    // Full analysis (from analyze_image tool)
    await store.addMessageMetadata(msg.id, '+1555000555', 'image_analysis', {
      driveFileId: 'drive123',
      driveUrl: 'https://drive.google.com/file/d/drive123',
      mimeType: 'image/jpeg',
      analysis: 'Detailed analysis: Whole Foods receipt with 15 line items...',
    });

    const metadata = await store.getMessageMetadata<ImageAnalysisMetadata>([msg.id], 'image_analysis');
    expect(metadata.get(msg.id)).toHaveLength(2);
    // Both should coexist (supplement, not replace)
    expect(metadata.get(msg.id)?.[0].analysis).toContain('Quick summary');
    expect(metadata.get(msg.id)?.[1].analysis).toContain('Detailed analysis');
  });

  it('should persist multiple pre-analysis summaries for multi-image message', async () => {
    const msg = await store.addMessage('+1555000666', 'user', '[User sent 2 images]', 'whatsapp');

    // Two pre-analysis summaries (one per image)
    await store.addMessageMetadata(msg.id, '+1555000666', 'image_analysis', {
      mimeType: 'image/jpeg',
      analysis: 'First image: a cat',
    });
    await store.addMessageMetadata(msg.id, '+1555000666', 'image_analysis', {
      mimeType: 'image/png',
      analysis: 'Second image: a dog',
    });

    const metadata = await store.getMessageMetadata<ImageAnalysisMetadata>([msg.id], 'image_analysis');
    expect(metadata.get(msg.id)).toHaveLength(2);
  });
});
