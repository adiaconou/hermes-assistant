/**
 * LLM Judge Module for E2E Tests
 *
 * Evaluates conversation transcripts against criteria using Claude Sonnet.
 * Reusable for both e2e test evaluation and production conversation diagnosis.
 *
 * Uses claude-sonnet-4-5-20250929 (NOT Opus) to save cost.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ConversationMessage } from '../../src/services/conversation/types.js';

export interface TurnLog {
  turnNumber: number;
  filePath: string;
  content: string;
}

export interface JudgeInput {
  messages: ConversationMessage[];
  generatedPages?: Map<string, string>;
  turnLogs?: TurnLog[];
  criteria: string[];
}

export interface JudgeVerdict {
  criteria: Array<{
    criterion: string;
    verdict: 'PASS' | 'FAIL';
    reason: string;
  }>;
  overall: 'PASS' | 'FAIL';
  summary: string;
}

/**
 * Format a conversation into a readable transcript for the judge.
 * Includes generated page HTML inline when available.
 */
export function formatTranscript(
  messages: ConversationMessage[],
  generatedPages?: Map<string, string>,
): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role.toUpperCase();
    lines.push(`[${role}]: ${msg.content}`);

    // If this is an assistant message and we have generated pages,
    // check if the message references any page URLs and include the HTML.
    if (msg.role === 'assistant' && generatedPages) {
      for (const [url, html] of generatedPages) {
        if (msg.content.includes(url)) {
          lines.push(`  [GENERATED PAGE ${url}]:`);
          lines.push(`  ${html.slice(0, 5000)}`);
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Safely parse the judge's JSON response.
 * Handles both raw JSON and fenced markdown code blocks.
 * Returns a diagnostic FAIL verdict on parse error.
 */
export function safeParseJudgeVerdict(rawText: string): JudgeVerdict {
  // Try direct JSON parse first
  try {
    return JSON.parse(rawText) as JudgeVerdict;
  } catch {
    // Try extracting from fenced markdown
  }

  // Try extracting JSON from ```json ... ``` or ``` ... ``` blocks
  const fencedMatch = rawText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1]) as JudgeVerdict;
    } catch {
      // Fall through to error verdict
    }
  }

  return {
    criteria: [],
    overall: 'FAIL',
    summary: 'Judge output was not valid JSON; verdict recorded as diagnostic failure.',
  };
}

/**
 * Evaluate a conversation transcript against criteria using Claude Sonnet.
 *
 * The judge receives the full conversation transcript, any generated page HTML,
 * and per-turn trace logs for qualitative analysis.
 */
export async function judge(input: JudgeInput): Promise<JudgeVerdict> {
  try {
    const transcript = formatTranscript(input.messages, input.generatedPages);
    const logSection = input.turnLogs?.length
      ? `\n\nTRACE LOGS (${input.turnLogs.length} turns):\n${input.turnLogs.map(t => `--- Turn ${t.turnNumber} ---\n${t.content}`).join('\n\n')}`
      : '\n\nTRACE LOGS: None';

    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are evaluating a multi-turn conversation between a user and an SMS assistant.

CONVERSATION TRANSCRIPT:
${transcript}
${logSection}

EVALUATION CRITERIA:
${input.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

For each criterion, respond with PASS or FAIL and a one-sentence explanation.
Then give an overall verdict: PASS (all criteria met) or FAIL (any criterion failed).
If trace logs are provided, factor them into your evaluation — errors during orchestration that did not prevent a correct final result are acceptable, but errors that indicate data loss, corruption, or silent failures should result in a FAIL.

Respond in JSON:
{
  "criteria": [
    { "criterion": "...", "verdict": "PASS|FAIL", "reason": "..." }
  ],
  "overall": "PASS|FAIL",
  "summary": "One-sentence overall assessment"
}`,
      }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return {
        criteria: [],
        overall: 'FAIL',
        summary: 'Judge returned no text content.',
      };
    }

    return safeParseJudgeVerdict(textBlock.text);
  } catch (error) {
    return {
      criteria: [],
      overall: 'FAIL',
      summary: `Judge call failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Build a JudgeInput from a production conversation database query.
 * This enables reusing the judge for diagnosing production errors.
 */
export async function fromDatabase(
  phoneNumber: string,
  options?: { since?: Date; limit?: number },
): Promise<Omit<JudgeInput, 'criteria'>> {
  const { getConversationStore } = await import(
    '../../src/services/conversation/index.js'
  );
  const store = getConversationStore();
  const messages = await store.getHistory(phoneNumber, {
    since: options?.since?.getTime(),
    limit: options?.limit ?? 50,
  });
  return { messages, generatedPages: undefined, turnLogs: undefined };
}
