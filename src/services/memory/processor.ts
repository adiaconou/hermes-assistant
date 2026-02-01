/**
 * @fileoverview Async memory processor - extracts user facts from conversations.
 *
 * ## Processing Flow
 *
 * 1. A background poller runs every N minutes (default: 5 min)
 * 2. Fetches unprocessed user messages from ConversationStore
 * 3. Groups messages by phone number for batch processing
 * 4. For each user batch:
 *    a. Loads existing facts (to avoid duplicates)
 *    b. Sends messages + existing facts to Claude for extraction
 *    c. Parses JSON response containing new facts
 *    d. Filters out duplicates (backup check)
 *    e. Stores new facts in MemoryStore
 *    f. Marks messages as processed (so they won't be processed again)
 * 5. Failed batches are NOT marked as processed, allowing retry next cycle
 *
 * ## Why Background Processing?
 *
 * Running extraction async (not during conversation) keeps response latency low.
 * Users can also explicitly ask to remember things via the memory-agent,
 * which provides immediate feedback.
 *
 * @see ./prompts.ts for the extraction prompt and design decisions
 */

import Anthropic from '@anthropic-ai/sdk';
import config from '../../config.js';
import { getConversationStore, type ConversationMessage } from '../conversation/index.js';
import { getMemoryStore, type UserFact } from './index.js';
import { createIntervalPoller, type Poller } from '../scheduler/poller.js';
import { buildExtractionPrompt } from './prompts.js';
import { writeDebugLog } from '../../utils/trace-logger.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export interface ProcessingError {
  phoneNumber: string;
  messageIds: string[];
  error: string;
}

export interface ProcessingResult {
  messagesProcessed: number;
  factsExtracted: number;
  errors: ProcessingError[];
}

interface ExtractedFact {
  fact: string;
  category?: string;
}

/** Debug data captured during user message processing */
interface UserProcessingDebug {
  phoneNumber: string;
  messages: ConversationMessage[];
  existingFactsCount: number;
  prompt: string;
  llmResponse: string;
  extractedFacts: ExtractedFact[];
  storedFacts: ExtractedFact[];
  duplicatesSkipped: number;
  error?: string;
}

/**
 * Parse the LLM response to extract facts.
 *
 * The prompt asks Claude to return a JSON array like:
 *   [{"fact": "Likes coffee", "category": "preferences"}, ...]
 *
 * Claude may include explanation text before/after the JSON, so we
 * extract just the array portion using regex.
 */
function parseExtractedFacts(response: string): ExtractedFact[] {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is ExtractedFact =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.fact === 'string' &&
        item.fact.trim().length > 0
    );
  } catch {
    return [];
  }
}

/**
 * Format a millisecond timestamp as ISO string.
 */
function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Format a duration in milliseconds as a compact string (e.g., 1h 3m 5s).
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || hours) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

/**
 * Check if a fact is a duplicate (case-insensitive exact match).
 *
 * This is a backup check. The LLM is instructed to skip duplicates
 * (it sees existing facts in the prompt), but we double-check here
 * in case it misses one. Phase 2 will add semantic similarity.
 */
function isDuplicate(newFact: string, existingFacts: UserFact[]): boolean {
  const normalized = newFact.toLowerCase().trim();
  return existingFacts.some((f) => f.fact.toLowerCase().trim() === normalized);
}

/**
 * Process a batch of messages for a single user.
 *
 * Flow:
 * 1. Load user's existing facts (passed to LLM for deduplication)
 * 2. Build extraction prompt with messages + existing facts
 * 3. Call Claude to extract new facts
 * 4. Parse JSON response
 * 5. Store each non-duplicate fact
 *
 * Note: We track facts added within this batch to prevent duplicates
 * if the LLM returns the same fact multiple times in one response.
 *
 * Returns both the result and debug data for logging.
 */
async function processUserMessages(
  phoneNumber: string,
  messages: ConversationMessage[]
): Promise<{ factsExtracted: number; debug: UserProcessingDebug }> {
  const memoryStore = getMemoryStore();
  const existingFacts = await memoryStore.getFacts(phoneNumber);

  // Build and send extraction request
  const prompt = buildExtractionPrompt(existingFacts, messages);

  const response = await client.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract text from response
  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Parse extracted facts
  const extractedFacts = parseExtractedFacts(responseText);
  const storedFacts: ExtractedFact[] = [];
  let duplicatesSkipped = 0;

  // Store non-duplicate facts
  const now = Date.now();
  for (const extracted of extractedFacts) {
    if (!isDuplicate(extracted.fact, existingFacts)) {
      await memoryStore.addFact({
        phoneNumber,
        fact: extracted.fact,
        category: extracted.category,
        extractedAt: now,
      });
      storedFacts.push(extracted);

      // Track this fact locally so if Claude returns duplicates in the same
      // response (e.g., "Likes coffee" twice), we catch it on the second one
      existingFacts.push({
        id: '',
        phoneNumber,
        fact: extracted.fact,
        category: extracted.category,
        extractedAt: now,
      });
    } else {
      duplicatesSkipped++;
    }
  }

  return {
    factsExtracted: storedFacts.length,
    debug: {
      phoneNumber,
      messages,
      existingFactsCount: existingFacts.length - storedFacts.length, // Count before adding new ones
      prompt,
      llmResponse: responseText,
      extractedFacts,
      storedFacts,
      duplicatesSkipped,
    },
  };
}

/** Data passed to formatDebugLog */
interface DebugLogData {
  timestamp: string;
  config: {
    batchSize: number;
    perUserBatchSize: number;
    intervalMs: number;
  };
  messagesRetrieved: ConversationMessage[];
  userResults: UserProcessingDebug[];
  summary: ProcessingResult;
  durationMs: number;
}

/**
 * Format the debug log content as a human-readable string.
 */
function formatDebugLog(data: DebugLogData): string {
  const lines: string[] = [];
  const divider = '='.repeat(80);
  const sectionDivider = '-'.repeat(80);
  const now = Date.now();

  // Header
  lines.push(divider);
  lines.push(`MEMORY PROCESSOR RUN | ${data.timestamp}`);
  lines.push(divider);
  lines.push('');

  // Configuration
  lines.push('CONFIGURATION');
  lines.push(`  Batch size: ${data.config.batchSize}`);
  lines.push(`  Per-user batch size: ${data.config.perUserBatchSize}`);
  lines.push(`  Interval: ${data.config.intervalMs}ms`);
  lines.push('');

  // Messages retrieved
  lines.push(sectionDivider);
  lines.push(`MESSAGES RETRIEVED (${data.messagesRetrieved.length} total)`);
  lines.push(sectionDivider);
  lines.push('');

  // Group messages by user for display
  const messagesByUser = new Map<string, ConversationMessage[]>();
  for (const msg of data.messagesRetrieved) {
    const existing = messagesByUser.get(msg.phoneNumber) || [];
    existing.push(msg);
    messagesByUser.set(msg.phoneNumber, existing);
  }

  for (const [phone, msgs] of messagesByUser) {
    const phoneSuffix = phone.slice(-4);
    lines.push(`[User ...${phoneSuffix}] ${msgs.length} message(s):`);
    for (const msg of msgs) {
      const createdIso = formatIso(msg.createdAt);
      const ageMs = Math.max(0, now - msg.createdAt);
      const age = formatDuration(ageMs);
      const preview = msg.content.length > 80
        ? msg.content.substring(0, 80) + '...'
        : msg.content;
      lines.push(
        `  - [${msg.id.substring(0, 8)}] "${preview}" | created ${createdIso} (${age} ago)`
      );
    }
    lines.push('');
  }

  // Extraction results per user
  lines.push(sectionDivider);
  lines.push('EXTRACTION RESULTS');
  lines.push(sectionDivider);
  lines.push('');

  for (const userResult of data.userResults) {
    const phoneSuffix = userResult.phoneNumber.slice(-4);
    lines.push(`[User ...${phoneSuffix}]`);

    if (userResult.error) {
      lines.push(`  ERROR: ${userResult.error}`);
      lines.push('');
      continue;
    }

    lines.push(`  Existing facts: ${userResult.existingFactsCount}`);
    lines.push(`  Messages processed: ${userResult.messages.length}`);
    lines.push('');

    // Prompt (truncated for readability)
    lines.push('  --- PROMPT SENT TO LLM ---');
    const promptLines = userResult.prompt.split('\n');
    if (promptLines.length > 50) {
      lines.push(...promptLines.slice(0, 25).map(l => '  ' + l));
      lines.push(`  ... (${promptLines.length - 50} lines omitted) ...`);
      lines.push(...promptLines.slice(-25).map(l => '  ' + l));
    } else {
      lines.push(...promptLines.map(l => '  ' + l));
    }
    lines.push('  --- END PROMPT ---');
    lines.push('');

    // LLM Response
    lines.push('  --- LLM RESPONSE ---');
    lines.push('  ' + userResult.llmResponse);
    lines.push('  --- END RESPONSE ---');
    lines.push('');

    // Facts extracted
    lines.push(`  Facts extracted: ${userResult.extractedFacts.length}`);
    lines.push(`  Facts stored: ${userResult.storedFacts.length}`);
    lines.push(`  Duplicates skipped: ${userResult.duplicatesSkipped}`);
    lines.push('');

    if (userResult.storedFacts.length > 0) {
      lines.push('  Stored facts:');
      for (const fact of userResult.storedFacts) {
        const category = fact.category || 'uncategorized';
        lines.push(`    ✓ "${fact.fact}" (${category})`);
      }
      lines.push('');
    }
  }

  // Summary
  lines.push(sectionDivider);
  lines.push('SUMMARY');
  lines.push(sectionDivider);
  const userCount = messagesByUser.size;
  const createdTimes = data.messagesRetrieved.map((m) => m.createdAt);
  const oldest = createdTimes.length ? Math.min(...createdTimes) : null;
  const newest = createdTimes.length ? Math.max(...createdTimes) : null;
  lines.push(`  Users processed: ${userCount}`);
  lines.push(`  Messages processed: ${data.summary.messagesProcessed} (retrieved: ${data.messagesRetrieved.length})`);
  if (oldest !== null && newest !== null) {
    lines.push(
      `  Oldest message: ${formatIso(oldest)} (${formatDuration(now - oldest)} ago)`
    );
    lines.push(
      `  Newest message: ${formatIso(newest)} (${formatDuration(now - newest)} ago)`
    );
  }
  lines.push(`  Facts extracted: ${data.summary.factsExtracted}`);
  lines.push(`  Errors: ${data.summary.errors.length}`);
  lines.push(`  Duration: ${data.durationMs}ms`);
  lines.push('');

  // Footer
  lines.push(divider);
  lines.push('END MEMORY PROCESSOR RUN');
  lines.push(divider);

  return lines.join('\n');
}

/**
 * Main entry point: process all unprocessed messages.
 *
 * Flow:
 * 1. Fetch unprocessed messages (FIFO order, capped per-user to prevent
 *    one chatty user from blocking others)
 * 2. Group messages by phone number
 * 3. Process each user's batch sequentially (one LLM call per user)
 * 4. Mark successfully processed messages so they won't be retried
 *
 * Error handling: If a user's batch fails, those messages are NOT marked
 * as processed, so they'll be retried on the next cycle. Other users'
 * batches continue processing.
 */
export async function processUnprocessedMessages(): Promise<ProcessingResult> {
  const conversationStore = getConversationStore();
  const batchSize = config.memoryProcessor.batchSize;

  // Get unprocessed user messages in FIFO order with per-user cap
  const messages = await conversationStore.getUnprocessedMessages({
    limit: batchSize,
    perUserLimit: config.memoryProcessor.perUserBatchSize,
  });

  if (messages.length === 0) {
    console.log(JSON.stringify({
      event: 'memory_processor_no_work',
      timestamp: new Date().toISOString(),
    }));
    return { messagesProcessed: 0, factsExtracted: 0, errors: [] };
  }

  console.log(JSON.stringify({
    event: 'memory_processor_start',
    messageCount: messages.length,
    timestamp: new Date().toISOString(),
  }));

  // Group messages by phone number
  const messagesByUser = new Map<string, ConversationMessage[]>();
  for (const message of messages) {
    const existing = messagesByUser.get(message.phoneNumber) || [];
    existing.push(message);
    messagesByUser.set(message.phoneNumber, existing);
  }

  const result: ProcessingResult = {
    messagesProcessed: 0,
    factsExtracted: 0,
    errors: [],
  };

  // Collect debug data for each user
  const userDebugData: UserProcessingDebug[] = [];
  const startTime = Date.now();

  // Process each user's messages
  for (const [phoneNumber, userMessages] of messagesByUser) {
    const messageIds = userMessages.map((m) => m.id);

    try {
      const { factsExtracted, debug } = await processUserMessages(phoneNumber, userMessages);

      // Mark messages as processed
      await conversationStore.markAsProcessed(messageIds);

      result.messagesProcessed += userMessages.length;
      result.factsExtracted += factsExtracted;
      userDebugData.push(debug);

      console.log(JSON.stringify({
        event: 'memory_processor_user_complete',
        phoneNumberSuffix: phoneNumber.slice(-4),
        messagesProcessed: userMessages.length,
        factsExtracted,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(JSON.stringify({
        event: 'memory_processor_user_error',
        phoneNumberSuffix: phoneNumber.slice(-4),
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }));

      result.errors.push({
        phoneNumber,
        messageIds,
        error: errorMessage,
      });

      // Add error to debug data
      userDebugData.push({
        phoneNumber,
        messages: userMessages,
        existingFactsCount: 0,
        prompt: '',
        llmResponse: '',
        extractedFacts: [],
        storedFacts: [],
        duplicatesSkipped: 0,
        error: errorMessage,
      });

      // Don't mark as processed - will retry next cycle
    }
  }

  const durationMs = Date.now() - startTime;

  console.log(JSON.stringify({
    event: 'memory_processor_complete',
    messagesProcessed: result.messagesProcessed,
    factsExtracted: result.factsExtracted,
    errorCount: result.errors.length,
    timestamp: new Date().toISOString(),
  }));

  // Write debug log file (overwrites previous)
  writeDebugLog('memory-processor.log', formatDebugLog({
    timestamp: new Date().toISOString(),
    config: {
      batchSize: config.memoryProcessor.batchSize,
      perUserBatchSize: config.memoryProcessor.perUserBatchSize,
      intervalMs: config.memoryProcessor.intervalMs,
    },
    messagesRetrieved: messages,
    userResults: userDebugData,
    summary: result,
    durationMs,
  }));

  return result;
}

// ---------------------------------------------------------------------------
// Lifecycle: Start/Stop the background processor
// ---------------------------------------------------------------------------

let poller: Poller | null = null;

/**
 * Start the memory processor.
 * Runs periodically to extract facts from unprocessed messages.
 */
export function startMemoryProcessor(): void {
  if (!config.memoryProcessor.enabled) {
    console.log(JSON.stringify({
      event: 'memory_processor_disabled',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  if (poller) {
    console.log(JSON.stringify({
      event: 'memory_processor_already_running',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  poller = createIntervalPoller(
    async () => { await processUnprocessedMessages(); },
    config.memoryProcessor.intervalMs
  );

  poller.start();

  console.log(JSON.stringify({
    event: 'memory_processor_started',
    intervalMs: config.memoryProcessor.intervalMs,
    batchSize: config.memoryProcessor.batchSize,
    perUserBatchSize: config.memoryProcessor.perUserBatchSize,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Stop the memory processor.
 */
export function stopMemoryProcessor(): void {
  if (poller) {
    poller.stop();
    poller = null;

    console.log(JSON.stringify({
      event: 'memory_processor_stopped',
      timestamp: new Date().toISOString(),
    }));
  }
}
