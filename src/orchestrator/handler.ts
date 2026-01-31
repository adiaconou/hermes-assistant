/**
 * Orchestrator Handler
 *
 * Integration layer between the orchestrator and the message handling system.
 * Single path for executing user messages via orchestrator.
 *
 * Usage:
 * - Single entry point for processing inbound user messages
 * - Uses orchestrator for planning and execution
 * - Keeps the same signature previously used by legacy handlers
 */

import type { ConversationMessage } from '../services/conversation/types.js';
import type { UserConfig } from '../services/user-config/types.js';
import { getMemoryStore } from '../services/memory/index.js';
import { getConversationStore } from '../services/conversation/index.js';
import { orchestrate } from './orchestrate.js';
import { createTraceLogger } from '../utils/trace-logger.js';

/**
 * Handle a message using the orchestrator if enabled.
 *
 * Uses the orchestrator for complex multi-step requests.
 * @param userMessage The user's message
 * @param phoneNumber User's phone number (for memory/context lookup)
 * @param channel Message channel (sms or whatsapp)
 * @param userConfig User configuration
 * @returns Response text to send back to the user
 */
export async function handleWithOrchestrator(
  userMessage: string,
  phoneNumber: string,
  channel: 'sms' | 'whatsapp',
  userConfig: UserConfig | null
): Promise<string> {
  // Create trace logger for this request
  const logger = createTraceLogger(phoneNumber);

  logger.log('INFO', 'Incoming SMS request', {
    Phone: phoneNumber,
    Channel: channel,
    Message: userMessage,
  });

  console.log(JSON.stringify({
    level: 'info',
    message: 'Using orchestrator for message handling',
    timestamp: new Date().toISOString(),
  }));

  try {
    // Load context for orchestrator
    const [conversationStore, memoryStore] = [
      getConversationStore(),
      getMemoryStore(),
    ];

    const [conversationHistory, userFacts] = await Promise.all([
      conversationStore.getHistory(phoneNumber, { limit: 50 }),
      memoryStore.getFacts(phoneNumber),
    ]);

    logger.log('DEBUG', 'Loading conversation context', {
      'History messages': conversationHistory.length,
      'User facts': userFacts.length,
    });

    // Run orchestrator
    const result = await orchestrate(
      userMessage,
      conversationHistory,
      userFacts,
      userConfig,
      phoneNumber,
      channel,
      logger
    );

    if (result.success) {
      logger.close('SUCCESS');
      return result.response;
    }

    // Orchestration failed - log and return error response
    console.error(JSON.stringify({
      level: 'error',
      message: 'Orchestration failed',
      error: result.error,
      timestamp: new Date().toISOString(),
    }));

    logger.close('FAILED');
    return result.response || 'I encountered an issue processing your request. Please try again.';
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Orchestrator handler error',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));

    logger.log('ERROR', 'Orchestrator handler error', {
      Error: error instanceof Error ? error.message : String(error),
    });
    logger.close('FAILED');

    // On error, surface a generic failure without invoking legacy path
    return 'I encountered an issue processing your request. Please try again.';
  }
}
