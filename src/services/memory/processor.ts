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
import { clampConfidence } from './ranking.js';

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
  confidence?: number;
  sourceType?: 'explicit' | 'inferred';
  evidence?: string;
}

interface ParsedFactsResult {
  facts: ExtractedFact[];
  reasoning: string;
  raw: string;
}

class ParseError extends Error {
  readonly kind = 'parse_fail';
}

class LlmError extends Error {
  readonly kind = 'llm_error';
}

const RETRY_BACKOFF_MS = config.nodeEnv === 'test' ? 0 : 30000;
const EVIDENCE_MAX_CHARS = 120;
const ASSISTANT_SUMMARY_CUE = /\b(found|i found|your (calendar|email)|i see|based on your (email|calendar)|according to|shows|statement|invoice|receipt|meeting)\b/i;

/** Debug data captured during user message processing */
interface UserProcessingDebug {
  phoneNumber: string;
  messages: ConversationMessage[];
  messagesSkipped: number;
  assistantIncluded: number;
  existingFactsCount: number;
  prompt: string;
  llmResponse: string;
  llmReasoning: string;
  extractedFacts: ExtractedFact[];
  storedFacts: ExtractedFact[];
  duplicatesSkipped: number;
  reinforcedFacts: number;
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
function findJsonEnd(text: string, start: number, openChar: '{' | '[', closeChar: '}' | ']'): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function extractJsonPayload(response: string): unknown | null {
  const trimmed = response.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to scanning
    }
  }

  for (let i = 0; i < response.length; i++) {
    const char = response[i];
    if (char !== '{' && char !== '[') continue;
    const openChar = char;
    const closeChar = char === '{' ? '}' : ']';
    const end = findJsonEnd(response, i, openChar, closeChar);
    if (end === -1) continue;
    const candidate = response.slice(i, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning for another candidate
    }
  }

  return null;
}

function normalizeEvidence(evidence: string | undefined): string | undefined {
  if (!evidence) return undefined;
  const trimmed = evidence.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  if (trimmed.length <= EVIDENCE_MAX_CHARS) return trimmed;
  return trimmed.slice(trimmed.length - EVIDENCE_MAX_CHARS);
}

function normalizeExtractedFact(item: unknown): ExtractedFact | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const factText = typeof record.fact === 'string' ? record.fact.trim() : '';
  if (!factText) {
    return null;
  }

  const category =
    typeof record.category === 'string' && record.category.trim().length > 0
      ? record.category.trim()
      : undefined;

  const confidenceRaw = typeof record.confidence === 'number'
    ? record.confidence
    : 0.5;
  const confidence = clampConfidence(confidenceRaw);

  const sourceTypeRaw = typeof record.source_type === 'string'
    ? record.source_type
    : typeof record.sourceType === 'string'
      ? record.sourceType
      : undefined;
  const sourceType = sourceTypeRaw === 'explicit' || sourceTypeRaw === 'inferred'
    ? sourceTypeRaw
    : 'inferred';

  const evidenceRaw = typeof record.evidence === 'string' ? record.evidence : undefined;
  const evidence = normalizeEvidence(evidenceRaw);

  return {
    fact: factText,
    category,
    confidence,
    sourceType,
    evidence,
  };
}

function parseExtractedFacts(response: string): ParsedFactsResult {
  const payload = extractJsonPayload(response);
  if (!payload) {
    throw new ParseError('Failed to parse JSON from LLM response');
  }

  // Extract reasoning from the response object
  let reasoning = '';
  if (typeof payload === 'object' && payload !== null) {
    const payloadObj = payload as Record<string, unknown>;
    if (typeof payloadObj.reasoning === 'string') {
      reasoning = payloadObj.reasoning;
    }
  }

  const factArray = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null && Array.isArray((payload as { facts?: unknown }).facts)
      ? (payload as { facts: unknown[] }).facts
      : null;

  if (!factArray) {
    throw new ParseError('LLM response missing facts array');
  }

  const normalized = factArray
    .map(normalizeExtractedFact)
    .filter((fact): fact is ExtractedFact => fact !== null);

  return { facts: normalized, reasoning, raw: response };
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
function findSimilarFact(newFact: string, existingFacts: UserFact[]): UserFact | null {
  const normalized = newFact.toLowerCase().trim();
  return existingFacts.find((f) => f.fact.toLowerCase().trim() === normalized) ?? null;
}

function isAssistantSummary(message: string): boolean {
  return ASSISTANT_SUMMARY_CUE.test(message);
}

function buildReinforcedEvidence(existing: string | undefined, incoming: string | undefined, timestampIso: string): string | undefined {
  if (!incoming) {
    return existing;
  }
  const appended = existing
    ? `${existing} | ${timestampIso}: ${incoming}`
    : `${timestampIso}: ${incoming}`;
  if (appended.length <= EVIDENCE_MAX_CHARS) {
    return appended;
  }
  return appended.slice(appended.length - EVIDENCE_MAX_CHARS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
): Promise<{
  factsExtracted: number;
  reinforcedFacts: number;
  assistantIncluded: number;
  parseFailures: number;
  llmErrors: number;
  debug: UserProcessingDebug;
}> {
  const memoryStore = getMemoryStore();
  const existingFacts = await memoryStore.getFacts(phoneNumber);
  const existingFactsCount = existingFacts.length;

  // Always include user messages; include assistant messages that look like tool summaries
  const filteredMessages = messages.filter((message) => {
    if (message.role === 'user') return true;
    return isAssistantSummary(message.content);
  });
  const assistantIncluded = filteredMessages.filter((m) => m.role === 'assistant').length;
  const messagesSkipped = messages.length - filteredMessages.length;

  if (filteredMessages.length === 0) {
    return {
      factsExtracted: 0,
      reinforcedFacts: 0,
      assistantIncluded,
      parseFailures: 0,
      llmErrors: 0,
      debug: {
        phoneNumber,
        messages: [],
        messagesSkipped,
        assistantIncluded,
        existingFactsCount,
        prompt: '',
        llmResponse: '',
        llmReasoning: 'No messages to analyze after filtering.',
        extractedFacts: [],
        storedFacts: [],
        duplicatesSkipped: 0,
        reinforcedFacts: 0,
      },
    };
  }

  // Build and send extraction request
  const prompt = buildExtractionPrompt(existingFacts, filteredMessages);

  let responseText = '';
  let extractedFacts: ExtractedFact[] = [];
  let llmReasoning = '';
  let parseFailures = 0;
  let llmErrors = 0;

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const response = await client.messages.create({
        model: config.memoryProcessor.modelId,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      responseText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const parsed = parseExtractedFacts(responseText);
      extractedFacts = parsed.facts;
      llmReasoning = parsed.reasoning;
      break;
    } catch (error) {
      if (error instanceof ParseError) {
        parseFailures++;
      } else {
        llmErrors++;
      }

      if (attempt >= 1) {
        if (error instanceof ParseError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new LlmError(message);
      }

      if (RETRY_BACKOFF_MS > 0) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }

  const storedFacts: ExtractedFact[] = [];
  let duplicatesSkipped = 0;
  let reinforcedFacts = 0;
  const seenInBatch = new Set<string>();

  // Store non-duplicate facts
  const now = Date.now();
  for (const extracted of extractedFacts) {
    const normalizedKey = extracted.fact.toLowerCase().trim();
    if (seenInBatch.has(normalizedKey)) {
      duplicatesSkipped++;
      continue;
    }
    seenInBatch.add(normalizedKey);

    const existing = findSimilarFact(extracted.fact, existingFacts);
    if (existing) {
      const reinforcedAt = now;
      const updatedConfidence = clampConfidence(existing.confidence + 0.1);
      const updatedEvidence = buildReinforcedEvidence(
        existing.evidence,
        extracted.evidence,
        formatIso(reinforcedAt)
      );

      await memoryStore.updateFact(existing.id, {
        confidence: updatedConfidence,
        lastReinforcedAt: reinforcedAt,
        evidence: updatedEvidence,
      });

      existing.confidence = updatedConfidence;
      existing.lastReinforcedAt = reinforcedAt;
      if (updatedEvidence) {
        existing.evidence = updatedEvidence;
      }

      duplicatesSkipped++;
      reinforcedFacts++;
      continue;
    }

    const confidence = clampConfidence(extracted.confidence ?? 0.5);
    const sourceType = extracted.sourceType ?? 'inferred';

    await memoryStore.addFact({
      phoneNumber,
      fact: extracted.fact,
      category: extracted.category,
      confidence,
      sourceType,
      evidence: extracted.evidence,
      lastReinforcedAt: now,
      extractedAt: now,
    });
    storedFacts.push(extracted);

    existingFacts.push({
      id: '',
      phoneNumber,
      fact: extracted.fact,
      category: extracted.category,
      confidence,
      sourceType,
      evidence: extracted.evidence,
      lastReinforcedAt: now,
      extractedAt: now,
    });
  }

  return {
    factsExtracted: storedFacts.length,
    reinforcedFacts,
    assistantIncluded,
    parseFailures,
    llmErrors,
    debug: {
      phoneNumber,
      messages: filteredMessages,
      messagesSkipped,
      assistantIncluded,
      existingFactsCount,
      prompt,
      llmResponse: responseText,
      llmReasoning,
      extractedFacts,
      storedFacts,
      duplicatesSkipped,
      reinforcedFacts,
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

  if (data.messagesRetrieved.length === 0) {
    lines.push('  (No unprocessed messages found)');
    lines.push('');
  } else {
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
    lines.push(`  Messages analyzed: ${userResult.messages.length}`);
    lines.push(`  Messages skipped: ${userResult.messagesSkipped}`);
    if (userResult.assistantIncluded > 0) {
      lines.push(`  Assistant summaries included: ${userResult.assistantIncluded}`);
    }
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

    // LLM Reasoning
    if (userResult.llmReasoning) {
      lines.push('  --- LLM REASONING ---');
      lines.push('  ' + userResult.llmReasoning);
      lines.push('  --- END REASONING ---');
      lines.push('');
    }

    // Facts extracted
    lines.push(`  Facts extracted: ${userResult.extractedFacts.length}`);
    lines.push(`  Facts stored: ${userResult.storedFacts.length}`);
    lines.push(`  Duplicates skipped: ${userResult.duplicatesSkipped}`);
    if (userResult.reinforcedFacts > 0) {
      lines.push(`  Facts reinforced: ${userResult.reinforcedFacts}`);
    }
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
  const memoryStore = getMemoryStore();
  const batchSize = config.memoryProcessor.batchSize;
  const metrics = {
    success: 0,
    parse_fail: 0,
    llm_error: 0,
    reinforced: 0,
    assistant_included: 0,
    stale_deleted: 0,
    poison: 0,
  };

  metrics.stale_deleted = await memoryStore.deleteStaleObservations();

  // Get unprocessed messages in FIFO order with per-user cap (always include assistant)
  const messages = await conversationStore.getUnprocessedMessages({
    limit: batchSize,
    perUserLimit: config.memoryProcessor.perUserBatchSize,
    includeAssistant: true,
  });

  if (messages.length === 0) {
    console.log(JSON.stringify({
      event: 'memory_processor_no_work',
      timestamp: new Date().toISOString(),
    }));

    // Write debug log even when no messages found
    if (config.nodeEnv === 'development' && config.memoryProcessor.logVerbose) {
      writeDebugLog('memory-processor.log', formatDebugLog({
        timestamp: new Date().toISOString(),
        config: {
          batchSize: config.memoryProcessor.batchSize,
          perUserBatchSize: config.memoryProcessor.perUserBatchSize,
          intervalMs: config.memoryProcessor.intervalMs,
        },
        messagesRetrieved: [],
        userResults: [],
        summary: { messagesProcessed: 0, factsExtracted: 0, errors: [] },
        durationMs: 0,
      }));
    }

    return { messagesProcessed: 0, factsExtracted: 0, errors: [] };
  }

  console.log(JSON.stringify({
    event: 'memory_processor_start',
    messageCount: messages.length,
    staleDeleted: metrics.stale_deleted,
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
      const {
        factsExtracted,
        reinforcedFacts,
        assistantIncluded,
        parseFailures,
        llmErrors,
        debug,
      } = await processUserMessages(phoneNumber, userMessages);

      // Mark messages as processed
      await conversationStore.markAsProcessed(messageIds);

      result.messagesProcessed += userMessages.length;
      result.factsExtracted += factsExtracted;
      metrics.success += 1;
      metrics.reinforced += reinforcedFacts;
      metrics.assistant_included += assistantIncluded;
      metrics.parse_fail += parseFailures;
      metrics.llm_error += llmErrors;
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
      const isParseError = error instanceof ParseError;
      const isLlmError = error instanceof LlmError;

      if (isParseError) {
        metrics.parse_fail += 1;
        metrics.poison += 1;
      } else if (isLlmError) {
        metrics.llm_error += 1;
        metrics.poison += 1;
      }

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
        messages: [],
        messagesSkipped: userMessages.length,
        assistantIncluded: 0,
        existingFactsCount: 0,
        prompt: '',
        llmResponse: '',
        llmReasoning: '',
        extractedFacts: [],
        storedFacts: [],
        duplicatesSkipped: 0,
        reinforcedFacts: 0,
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
    metrics,
    timestamp: new Date().toISOString(),
  }));

  // Write debug log file (overwrites previous)
  if (config.nodeEnv === 'development' && config.memoryProcessor.logVerbose) {
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
  }

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
 * Waits for any in-flight extraction to complete.
 */
export async function stopMemoryProcessor(): Promise<void> {
  if (poller) {
    await poller.stop();
    poller = null;

    console.log(JSON.stringify({
      event: 'memory_processor_stopped',
      timestamp: new Date().toISOString(),
    }));
  }
}
