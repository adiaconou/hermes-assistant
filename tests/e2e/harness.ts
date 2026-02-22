/**
 * E2E Test Harness
 *
 * Encapsulates the send-message-and-wait-for-response pattern for e2e tests.
 * Calls handleSmsWebhook directly (no HTTP server), mocks Twilio outbound,
 * and collects per-turn trace logs for LLM judge analysis.
 */

import fs from 'fs';
import path from 'path';
import { getExpectedTwilioSignature } from 'twilio/lib/webhooks/webhooks.js';
import { handleSmsWebhook } from '../../src/routes/sms.js';
import { createMockReqRes } from '../helpers/mock-http.js';
import { createWhatsAppPayload } from '../fixtures/webhook-payloads.js';
import { getSentMessages, clearSentMessages } from './mocks/twilio.js';
import { seedGoogleCredentials } from './mocks/google.js';
import { getConversationStore, closeConversationStore, resetConversationStore } from '../../src/services/conversation/index.js';
import { getMemoryStore, closeMemoryStore, resetMemoryStore } from '../../src/domains/memory/runtime/index.js';
import { resetCredentialStore } from '../../src/services/credentials/index.js';
import { getUserConfigStore, resetUserConfigStore } from '../../src/services/user-config/index.js';
import { getShortener, getStorage, resetProviders } from '../../src/services/ui/provider-factory.js';
import { E2E_TEMP_ROOT } from './setup.js';
import { judge, type JudgeVerdict, type TurnLog } from './judge.js';
import type { ConversationMessage } from '../../src/services/conversation/types.js';

export type { TurnLog, JudgeVerdict } from './judge.js';

export interface E2EResponse {
  syncResponse: string;
  asyncResponse: string | null;
  finalResponse: string;
}

/**
 * Extract the text content from a TwiML <Message> response.
 */
function extractTwimlMessage(xml: string): string {
  const match = xml.match(/<Message>([\s\S]*?)<\/Message>/);
  if (!match) return '';
  // Unescape XML entities
  return match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * E2E test harness for the SMS assistant.
 *
 * Sends simulated Twilio webhooks, waits for async responses,
 * collects trace logs, and delegates to the LLM judge for evaluation.
 */
export class E2EHarness {
  private phoneNumber: string;
  private turnCount = 0;
  private turnLogs: TurnLog[] = [];
  private seenLogFiles = new Set<string>();
  private generatedPages = new Map<string, string>();

  constructor(options?: { phoneNumber?: string }) {
    this.phoneNumber = options?.phoneNumber ?? '+15551234567';
  }

  /**
   * Initialize the harness. Seeds Google credentials for the test phone number.
   */
  async start(): Promise<void> {
    await seedGoogleCredentials(this.phoneNumber);
  }

  /**
   * Tear down the harness. Closes SQLite connections, resets all singletons,
   * and deletes the temp directory.
   */
  async stop(): Promise<void> {
    // 1. Close SQLite connections (must happen before file deletion)
    closeConversationStore();
    closeMemoryStore();
    const userConfigStore = getUserConfigStore() as unknown as { close?: () => void };
    if (typeof userConfigStore.close === 'function') {
      userConfigStore.close();
    }

    // 2. Reset all singletons so the next test run gets fresh instances
    resetConversationStore();
    resetMemoryStore();
    resetCredentialStore();
    resetUserConfigStore();
    resetProviders(); // UI storage + shortener

    // 3. Delete the entire temp directory
    fs.rmSync(E2E_TEMP_ROOT, { recursive: true, force: true });
  }

  /**
   * Send a simulated WhatsApp message and wait for the response.
   *
   * Uses WhatsApp payloads instead of SMS to avoid the 160-char SMS truncation
   * (enforceSmsLength passes WhatsApp messages through un-truncated). The webhook
   * handler is the same (/webhook/sms) — it detects channel from the whatsapp:
   * prefix on the From field.
   */
  async sendMessage(text: string, options?: { timeout?: number }): Promise<E2EResponse> {
    const timeout = options?.timeout ?? 90_000;
    const authToken = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';
    const webhookUrl = `${process.env.BASE_URL}/webhook/sms`;

    const payload = createWhatsAppPayload(text, this.phoneNumber);
    const signature = getExpectedTwilioSignature(
      authToken,
      webhookUrl,
      payload as unknown as Record<string, string>,
    );

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: '/webhook/sms',
      headers: { 'x-twilio-signature': signature },
      body: payload,
    });

    const sentBefore = getSentMessages().length;
    await handleSmsWebhook(req, res);

    // Extract sync response from TwiML
    const syncResponse = extractTwimlMessage(res.text ?? '');

    // Wait for async completion (Twilio message or trace log completion)
    const asyncCompleted = await this.waitForAsyncCompletion(sentBefore, timeout);

    // Collect the trace log file for this turn
    await this.collectTurnLog(this.turnCount++);

    if (asyncCompleted) {
      // Get the async response from either the Twilio message or conversation history
      const messages = getSentMessages();
      if (messages.length > sentBefore) {
        const asyncBody = messages[messages.length - 1].body;
        return { syncResponse, asyncResponse: asyncBody, finalResponse: asyncBody };
      }
      // Fallback: read from conversation history (un-truncated)
      const history = await this.getConversationHistory();
      const lastAssistant = history.filter(m => m.role === 'assistant').pop();
      const asyncBody = lastAssistant?.content ?? syncResponse;
      return { syncResponse, asyncResponse: asyncBody, finalResponse: asyncBody };
    }

    return { syncResponse, asyncResponse: null, finalResponse: syncResponse };
  }

  /**
   * Poll for async work completion.
   *
   * Returns true if async work completed (Twilio message sent or trace log
   * shows SUCCESS/FAILED). Returns false if no async work happened (no trace
   * log appears within the initial wait period).
   *
   * For sync-only messages (e.g., "Hello!"), no trace log or Twilio message
   * appears, so this returns false after a short initial wait (5s) rather
   * than hanging for the full timeout.
   */
  private async waitForAsyncCompletion(
    sentBefore: number,
    timeout: number,
  ): Promise<boolean> {
    const start = Date.now();
    const pollInterval = 500;
    const noActivityTimeout = 5_000; // If no trace log starts within 5s, assume sync-only
    let traceLogStarted = false;

    while (Date.now() - start < timeout) {
      // Check if a new Twilio message appeared (async response sent)
      const messages = getSentMessages();
      if (messages.length > sentBefore) {
        return true;
      }

      // Check trace log status
      const traceStatus = this.checkTraceLogStatus();

      if (traceStatus === 'completed') {
        // Trace log has SUCCESS footer — async work finished
        // Wait briefly for the Twilio message to be sent
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true;
      }

      if (traceStatus === 'failed') {
        // Trace log has FAILED footer — give grace period for error message
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true; // Still counts as "completed" (with failure)
      }

      if (traceStatus === 'in_progress') {
        traceLogStarted = true;
      }

      // If no trace log has started after the initial wait, assume sync-only
      if (!traceLogStarted && Date.now() - start > noActivityTimeout) {
        return false;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout — return whether we saw any activity
    return traceLogStarted;
  }

  /**
   * Check the status of the latest trace log file.
   * Returns 'in_progress' if a log file exists but has no footer,
   * 'completed' if it has a SUCCESS footer,
   * 'failed' if it has a FAILED footer,
   * or 'none' if no log file exists.
   */
  private checkTraceLogStatus(): 'none' | 'in_progress' | 'completed' | 'failed' {
    const logDir = process.env.TRACE_LOG_DIR;
    if (!logDir) return 'none';

    const dateDir = new Date().toISOString().split('T')[0];
    const fullDir = path.join(logDir, dateDir);
    if (!fs.existsSync(fullDir)) return 'none';

    const files = fs.readdirSync(fullDir).sort();
    const newFiles = files.filter(f => !this.seenLogFiles.has(f));
    if (newFiles.length === 0) return 'none';

    // Check the most recent new log file
    const latestFile = newFiles[newFiles.length - 1];
    const filePath = path.join(fullDir, latestFile);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('Status: FAILED')) return 'failed';
      if (content.includes('Status: SUCCESS')) return 'completed';
      return 'in_progress';
    } catch {
      return 'none';
    }
  }

  /**
   * Scan the trace log directory for new files and store their content.
   */
  private async collectTurnLog(turnNumber: number): Promise<TurnLog | null> {
    const logDir = process.env.TRACE_LOG_DIR;
    if (!logDir) return null;

    const dateDir = new Date().toISOString().split('T')[0];
    const fullDir = path.join(logDir, dateDir);
    if (!fs.existsSync(fullDir)) return null;

    const files = fs.readdirSync(fullDir).sort();
    const newFiles = files.filter(f => !this.seenLogFiles.has(f));
    if (newFiles.length === 0) return null;

    // Take the most recent new file (there should be exactly one per turn)
    const logFile = newFiles[newFiles.length - 1];
    this.seenLogFiles.add(logFile);
    const filePath = path.join(fullDir, logFile);
    const content = fs.readFileSync(filePath, 'utf-8');
    const turnLog: TurnLog = { turnNumber, filePath, content };
    this.turnLogs.push(turnLog);
    return turnLog;
  }

  /**
   * Reset between tests within a suite. Clears conversation history,
   * memory facts, and sent messages. Does NOT close SQLite connections
   * or reset singletons — that is stop()'s job.
   */
  async reset(): Promise<void> {
    // Clear conversation history by closing and resetting the store,
    // then re-seeding credentials. The store will be lazily recreated
    // with a fresh database on next access.
    closeConversationStore();
    resetConversationStore();

    closeMemoryStore();
    resetMemoryStore();

    clearSentMessages();
    this.turnCount = 0;
    this.turnLogs = [];
    this.seenLogFiles.clear();
    this.generatedPages.clear();

    // Re-seed Google credentials for the test phone number
    await seedGoogleCredentials(this.phoneNumber);
  }

  /**
   * Extract a /u/:id short URL from assistant response text.
   *
   * Handles bare URLs, markdown links, trailing punctuation,
   * and protocol-less formats.
   */
  extractShortUrl(responseText: string): string {
    const match = responseText.match(/(?:https?:\/\/[^\s)\]]+)?\/u\/([a-zA-Z0-9_-]+)/);
    if (!match) {
      throw new Error(
        `No /u/:id short URL found in response. Full response text:\n${responseText}`
      );
    }
    return `/u/${match[1]}`;
  }

  /**
   * Resolve a short URL through the real shortener and fetch the stored HTML.
   */
  async fetchPageHtml(shortUrl: string): Promise<string> {
    // Extract the short ID from /u/:id
    const idMatch = shortUrl.match(/\/u\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) {
      throw new Error(`Invalid short URL format: ${shortUrl}`);
    }
    const shortId = idMatch[1];

    const shortener = getShortener();
    const resolved = await shortener.resolve(shortId);
    if (!resolved) {
      throw new Error(`Short URL ${shortUrl} could not be resolved. ID: ${shortId}`);
    }

    const storage = getStorage();
    const html = await storage.fetch(resolved.key);

    // Track generated pages for the judge
    this.generatedPages.set(shortUrl, html);

    return html;
  }

  /**
   * Send the conversation transcript and trace logs to the LLM judge
   * for qualitative evaluation against the provided criteria.
   */
  async judgeConversation(criteria: string[]): Promise<JudgeVerdict> {
    const history = await this.getConversationHistory();
    return judge({
      messages: history,
      generatedPages: this.generatedPages,
      turnLogs: this.turnLogs,
      criteria,
    });
  }

  /**
   * Get all collected turn logs.
   */
  getTurnLogs(): TurnLog[] {
    return [...this.turnLogs];
  }

  /**
   * Get all generated pages fetched via fetchPageHtml().
   * Map keys are short URLs (e.g. /u/abc), values are the full HTML content.
   */
  getGeneratedPages(): Map<string, string> {
    return new Map(this.generatedPages);
  }

  /**
   * Get conversation history from the store for the test phone number.
   */
  async getConversationHistory(): Promise<ConversationMessage[]> {
    const store = getConversationStore();
    return store.getHistory(this.phoneNumber);
  }
}
