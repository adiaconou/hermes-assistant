/**
 * Media Pre-Analysis Service
 *
 * Runs a quick Gemini analysis on image attachments BEFORE the planner,
 * producing compact summaries that help the planner make informed routing
 * decisions. Non-image files are skipped in phase 1.
 *
 * Timeouts:
 * - Per image: config.mediaFirstPlanning.perImageTimeoutMs (default 5s)
 * - Total: 8s for the full batch
 *
 * On failure the caller falls back to the existing hint-only path.
 */

import config from '../../config.js';
import { analyzeImage, isAnalyzableImage } from '../google/vision.js';
import { GeminiNotConfiguredError } from '../google/vision.js';
import type { CurrentMediaSummary, MediaCategory } from '../conversation/types.js';

/**
 * Image buffer paired with its source attachment metadata.
 * Produced by the download step; consumed by pre-analysis.
 */
export type ImageBufferEntry = {
  buffer: Buffer;
  mimeType: string;
  index: number;
};

/**
 * Bounded prompt for pre-analysis.
 * Asks for a short summary + optional category — no deep OCR.
 */
const PRE_ANALYSIS_PROMPT = `Describe this image in 2-3 short sentences. Focus on what the image shows and its likely purpose.

Then on a new line output exactly one of these category labels:
receipt, data_table, chart, screenshot, photo, document, unknown

Format:
<summary>
Your 2-3 sentence description here.
</summary>
<category>label</category>`;

const VALID_CATEGORIES = new Set<MediaCategory>([
  'receipt', 'data_table', 'chart', 'screenshot', 'photo', 'document', 'unknown',
]);
const PRE_ANALYSIS_TOTAL_TIMEOUT_MS = 8_000;
const PRE_ANALYSIS_MAX_SUMMARY_CHARS = 300;

/**
 * Parse the pre-analysis response into summary + category.
 */
function parsePreAnalysisResponse(raw: string, maxChars: number): { summary: string; category?: MediaCategory } {
  // Extract summary
  const summaryMatch = raw.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/);
  let summary = summaryMatch ? summaryMatch[1].trim() : raw.trim();

  // Enforce character limit
  if (summary.length > maxChars) {
    summary = summary.slice(0, maxChars - 3) + '...';
  }

  // Extract category
  const categoryMatch = raw.match(/<category>\s*(\w+)\s*<\/category>/);
  const categoryRaw = categoryMatch ? categoryMatch[1].trim().toLowerCase() : undefined;
  const category = categoryRaw && VALID_CATEGORIES.has(categoryRaw as MediaCategory)
    ? (categoryRaw as MediaCategory)
    : undefined;

  return { summary, category };
}

/**
 * Run a promise with a timeout. Resolves to null if the timeout fires first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Pre-analyze a single image attachment.
 * Returns null on timeout or error (caller should skip silently).
 */
async function preAnalyzeOne(
  entry: ImageBufferEntry,
  perImageTimeoutMs: number,
  maxSummaryChars: number,
): Promise<CurrentMediaSummary | null> {
  const startTime = Date.now();

  try {
    const raw = await withTimeout(
      analyzeImage(entry.buffer, entry.mimeType, PRE_ANALYSIS_PROMPT),
      perImageTimeoutMs,
    );

    if (raw === null) {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Pre-analysis timed out for attachment',
        index: entry.index,
        timeoutMs: perImageTimeoutMs,
        timestamp: new Date().toISOString(),
      }));
      return null;
    }

    const { summary, category } = parsePreAnalysisResponse(raw, maxSummaryChars);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Pre-analysis complete',
      index: entry.index,
      category: category || 'none',
      summaryLength: summary.length,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    return {
      attachment_index: entry.index,
      mime_type: entry.mimeType,
      category,
      summary,
    };
  } catch (error) {
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Pre-analysis failed for attachment',
      index: entry.index,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));
    return null;
  }
}

/**
 * Pre-analyze all image attachments in parallel, respecting per-image
 * and total timeouts. Non-image files are skipped.
 *
 * @param entries Downloaded image buffers with metadata
 * @returns Array of successful summaries (may be empty on full timeout)
 */
export async function preAnalyzeMedia(
  entries: ImageBufferEntry[],
): Promise<CurrentMediaSummary[]> {
  if (!config.mediaFirstPlanning.enabled) return [];

  const imageEntries = entries.filter(e => isAnalyzableImage(e.mimeType));
  if (imageEntries.length === 0) return [];

  const { perImageTimeoutMs } = config.mediaFirstPlanning;

  const startTime = Date.now();

  try {
    // Run all image analyses in parallel, wrapped in the total timeout
    const results = await withTimeout(
      Promise.all(
        imageEntries.map(entry => preAnalyzeOne(entry, perImageTimeoutMs, PRE_ANALYSIS_MAX_SUMMARY_CHARS)),
      ),
      PRE_ANALYSIS_TOTAL_TIMEOUT_MS,
    );

    const durationMs = Date.now() - startTime;

    if (results === null) {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Pre-analysis total timeout exceeded',
        totalTimeoutMs: PRE_ANALYSIS_TOTAL_TIMEOUT_MS,
        imageCount: imageEntries.length,
        durationMs,
        timestamp: new Date().toISOString(),
      }));
      return [];
    }

    const summaries = results.filter((r): r is CurrentMediaSummary => r !== null);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Pre-analysis batch complete',
      total: imageEntries.length,
      successful: summaries.length,
      durationMs,
      timestamp: new Date().toISOString(),
    }));

    return summaries;
  } catch (error) {
    // Gemini not configured or other unrecoverable error — fall back silently
    if (error instanceof GeminiNotConfiguredError) {
      console.log(JSON.stringify({
        level: 'info',
        message: 'Pre-analysis skipped — Gemini not configured',
        timestamp: new Date().toISOString(),
      }));
    } else {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Pre-analysis batch failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
    }
    return [];
  }
}
