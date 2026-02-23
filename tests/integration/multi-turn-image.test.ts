/**
 * Integration test for multi-turn image conversations.
 *
 * Turn 1: Image message -> verify metadata persisted
 * Turn 2: Text follow-up -> verify orchestrator runs with <media_context>
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConversationStore } from '../../src/services/conversation/sqlite.js';
import type { StoredMediaAttachment, ImageAnalysisMetadata, CurrentMediaSummary } from '../../src/services/conversation/types.js';
import { formatMediaContext } from '../../src/orchestrator/media-context.js';

describe('multi-turn image conversation', () => {
  let store: SqliteConversationStore;

  beforeEach(() => {
    store = new SqliteConversationStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('turn 1: image message persists metadata; turn 2: follow-up gets media_context', async () => {
    const phoneNumber = '+15551112222';

    // ── Turn 1: User sends image ──
    const turn1Msg = await store.addMessage(phoneNumber, 'user', '[User sent an image]', 'whatsapp');

    // Simulate backfill of storedMedia (Phase 1B)
    const storedMedia: StoredMediaAttachment[] = [{
      driveFileId: 'drive_abc',
      filename: '2026-02-22_img_0.jpg',
      mimeType: 'image/jpeg',
      webViewLink: 'https://drive.google.com/file/d/drive_abc',
      originalIndex: 0,
    }];
    await store.updateMediaAttachments(turn1Msg.id, storedMedia);

    // Simulate pre-analysis persistence (Phase 1C)
    const preAnalysis: CurrentMediaSummary = {
      attachment_index: 0,
      mime_type: 'image/jpeg',
      category: 'receipt',
      summary: 'A grocery receipt from Whole Foods totaling $47.23',
    };
    await store.addMessageMetadata(turn1Msg.id, phoneNumber, 'image_analysis', {
      mimeType: preAnalysis.mime_type,
      analysis: preAnalysis.summary,
    });

    // Simulate full analysis (from analyze_image tool)
    await store.addMessageMetadata(turn1Msg.id, phoneNumber, 'image_analysis', {
      driveFileId: 'drive_abc',
      driveUrl: 'https://drive.google.com/file/d/drive_abc',
      mimeType: 'image/jpeg',
      analysis: 'Detailed receipt analysis: Whole Foods, 15 items, total $47.23, date 2026-02-22',
    });

    // Verify metadata persisted
    const metadata = await store.getMessageMetadata<ImageAnalysisMetadata>([turn1Msg.id], 'image_analysis');
    expect(metadata.get(turn1Msg.id)).toHaveLength(2);

    // Verify storedMedia backfilled
    const history1 = await store.getHistory(phoneNumber);
    const updatedMsg = history1.find(m => m.id === turn1Msg.id);
    expect(updatedMsg?.mediaAttachments).toHaveLength(1);
    expect(updatedMsg?.mediaAttachments?.[0].originalIndex).toBe(0);

    // Simulate assistant response for turn 1
    await store.addMessage(phoneNumber, 'assistant', 'I see a Whole Foods receipt for $47.23.', 'whatsapp');

    // ── Turn 2: User sends text follow-up about the image ──
    const turn2Msg = await store.addMessage(phoneNumber, 'user', 'What items were on that receipt?', 'whatsapp');

    // Build media context for turn 2 (as the orchestrator would)
    const turn2History = await store.getHistory(phoneNumber);
    const messageIds = turn2History.filter(m => m.role === 'user').map(m => m.id);
    const turn2Metadata = await store.getMessageMetadata<ImageAnalysisMetadata>(messageIds, 'image_analysis');

    const mediaContext = formatMediaContext(turn2Metadata, turn2History);

    // Verify media context contains the image analysis from turn 1
    expect(mediaContext).toContain('<media_context>');
    expect(mediaContext).toContain('Whole Foods');
    expect(mediaContext).toContain('drive_abc');
    expect(mediaContext).toContain('image/jpeg');

    // Both pre-analysis and full analysis should appear
    expect(mediaContext).toContain('grocery receipt');
    expect(mediaContext).toContain('Detailed receipt analysis');
  });

  it('originalIndex survives persistence round-trip', async () => {
    const phoneNumber = '+15553334444';

    const msg = await store.addMessage(phoneNumber, 'user', '[User sent 2 images]', 'whatsapp');

    // Simulate compacted array: only indices 0 and 2 uploaded successfully
    const attachments: StoredMediaAttachment[] = [
      { driveFileId: 'file_0', filename: 'img_0.jpg', mimeType: 'image/jpeg', originalIndex: 0 },
      { driveFileId: 'file_2', filename: 'img_2.png', mimeType: 'image/png', originalIndex: 2 },
    ];
    await store.updateMediaAttachments(msg.id, attachments);

    const history = await store.getHistory(phoneNumber);
    const updated = history.find(m => m.id === msg.id);
    expect(updated?.mediaAttachments).toHaveLength(2);
    expect(updated?.mediaAttachments?.[0].originalIndex).toBe(0);
    expect(updated?.mediaAttachments?.[1].originalIndex).toBe(2);
  });
});
