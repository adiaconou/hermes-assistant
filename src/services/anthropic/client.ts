/**
 * Anthropic client singleton.
 */

import Anthropic from '@anthropic-ai/sdk';
import config from '../../config.js';

let client: Anthropic | null = null;

/**
 * Get the Anthropic client instance.
 */
export function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}
