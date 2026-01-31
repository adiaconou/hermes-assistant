/**
 * @fileoverview Async memory processor.
 *
 * Periodically processes conversation messages to extract
 * user facts for the memory system.
 *
 * @see ./prompts.ts for the extraction prompt and design decisions
 */

import Anthropic from '@anthropic-ai/sdk';
import config from '../../config.js';
import { getConversationStore, type ConversationMessage } from '../conversation/index.js';
import { getMemoryStore, type UserFact } from './index.js';
import { createIntervalPoller, type Poller } from '../scheduler/poller.js';
import { buildExtractionPrompt } from './prompts.js';

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

/**
 * Parse the LLM response to extract facts.
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
 * Check if a fact is a duplicate (case-insensitive).
 */
function isDuplicate(newFact: string, existingFacts: UserFact[]): boolean {
  const normalized = newFact.toLowerCase().trim();
  return existingFacts.some((f) => f.fact.toLowerCase().trim() === normalized);
}

/**
 * Process a batch of messages for a single user.
 */
async function processUserMessages(
  phoneNumber: string,
  messages: ConversationMessage[]
): Promise<{ factsExtracted: number; error?: string }> {
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
  let factsExtracted = 0;

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
      factsExtracted++;

      // Add to existing facts to prevent duplicates within same batch
      existingFacts.push({
        id: '',
        phoneNumber,
        fact: extracted.fact,
        category: extracted.category,
        extractedAt: now,
      });
    }
  }

  return { factsExtracted };
}

/**
 * Process all unprocessed messages.
 * Groups messages by phone number for efficient batch processing.
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

  // Process each user's messages
  for (const [phoneNumber, userMessages] of messagesByUser) {
    const messageIds = userMessages.map((m) => m.id);

    try {
      const { factsExtracted } = await processUserMessages(phoneNumber, userMessages);

      // Mark messages as processed
      await conversationStore.markAsProcessed(messageIds);

      result.messagesProcessed += userMessages.length;
      result.factsExtracted += factsExtracted;

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

      // Don't mark as processed - will retry next cycle
    }
  }

  console.log(JSON.stringify({
    event: 'memory_processor_complete',
    messagesProcessed: result.messagesProcessed,
    factsExtracted: result.factsExtracted,
    errorCount: result.errors.length,
    timestamp: new Date().toISOString(),
  }));

  return result;
}

// Poller for memory processor
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
