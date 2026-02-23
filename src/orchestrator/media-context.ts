/**
 * Media Context Builder
 *
 * Formats image analysis metadata into a <media_context> block
 * that can be injected into agent prompts for multi-turn conversations.
 */

import type { ConversationMessage, ImageAnalysisMetadata, CurrentMediaSummary } from '../services/conversation/types.js';

/** Maximum length for individual analysis text before truncation */
const MAX_ANALYSIS_LENGTH = 2000;
const MAX_CURRENT_MEDIA_SUMMARIES = 5;
const MAX_CURRENT_MEDIA_SUMMARY_CHARS = 300;

/** Cap on historical media entries to keep context window manageable. */
export const MAX_HISTORICAL_MEDIA_ENTRIES = 10;

/**
 * Escape XML special characters to prevent prompt injection.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Truncate text with ellipsis if it exceeds max length.
 * Logs a warning when truncation occurs so it's visible in debugging.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  console.log(JSON.stringify({
    level: 'warn',
    message: 'Media analysis truncated',
    originalLength: text.length,
    maxLength,
    timestamp: new Date().toISOString(),
  }));
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format a relative timestamp for display.
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  return `${Math.floor(diffHours / 24)} day${Math.floor(diffHours / 24) === 1 ? '' : 's'} ago`;
}

/**
 * Build a formatted <media_context> block from metadata.
 *
 * @param metadataMap Map of messageId -> array of ImageAnalysisMetadata
 * @param history Conversation history (for ordering and context)
 * @returns Formatted XML string or empty string if no metadata
 */
export function formatMediaContext(
  metadataMap: Map<string, ImageAnalysisMetadata[]>,
  history: ConversationMessage[]
): string {
  if (metadataMap.size === 0) return '';

  // Build entries in conversation order
  const entries: string[] = [];

  for (const message of history) {
    const metadata = metadataMap.get(message.id);
    if (!metadata || metadata.length === 0) continue;

    const relativeTime = formatRelativeTime(message.createdAt);

    for (const item of metadata) {
      const escapedAnalysis = escapeXml(truncateText(item.analysis, MAX_ANALYSIS_LENGTH));
      const mimeType = item.mimeType || 'image/unknown';
      const driveFileId = item.driveFileId ? escapeXml(item.driveFileId) : '';
      const driveUrl = item.driveUrl ? escapeXml(item.driveUrl) : '';
      const driveFileTag = driveFileId ? `<drive_file_id>${driveFileId}</drive_file_id>` : '';
      const driveUrlTag = driveUrl ? `<drive_url>${driveUrl}</drive_url>` : '';
      const analysisTag = `<analysis>${escapedAnalysis}</analysis>`;
      const content = [driveFileTag, driveUrlTag, analysisTag].filter(Boolean).join('\n');

      entries.push(
        `<image message_id="${message.id}" time="${relativeTime}" type="${mimeType}">\n${content}\n</image>`
      );
    }
  }

  if (entries.length === 0) return '';

  // Keep most recent entries within cap
  const cappedEntries = entries.slice(-MAX_HISTORICAL_MEDIA_ENTRIES);

  return `<media_context>
The following images were previously analyzed in this conversation. Use this context to answer follow-up questions about images without re-analyzing them.

${cappedEntries.join('\n\n')}
</media_context>`;
}

/**
 * Check if media context should be injected.
 * Returns true if there's meaningful media context to add.
 */
export function hasMediaContext(mediaContext: string | undefined): boolean {
  return !!mediaContext && mediaContext.length > 0;
}

/**
 * Format current-turn media pre-analysis summaries into a <current_media> block
 * for planner prompt injection.
 *
 * Enforces hard caps on number of summaries and per-summary character length.
 * All text is XML-escaped to prevent prompt injection.
 *
 * @param summaries Pre-analysis summaries from Gemini
 * @returns Formatted XML string or empty string if no summaries
 */
export function formatCurrentMediaContext(summaries: CurrentMediaSummary[]): string {
  if (!summaries || summaries.length === 0) return '';

  const capped = summaries.slice(0, MAX_CURRENT_MEDIA_SUMMARIES);

  const entries = capped.map(s => {
    const summary = escapeXml(truncateText(s.summary, MAX_CURRENT_MEDIA_SUMMARY_CHARS));
    const categoryAttr = s.category ? ` category="${escapeXml(s.category)}"` : '';
    return `<attachment index="${s.attachment_index}" mime_type="${escapeXml(s.mime_type)}"${categoryAttr}>\n${summary}\n</attachment>`;
  });

  return `<current_media>
The user's current message includes the following media attachments. Use these summaries to understand what the user sent.

${entries.join('\n\n')}
</current_media>`;
}
