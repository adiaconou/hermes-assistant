/**
 * @fileoverview LLM-based email classifier.
 *
 * Classifies incoming emails against a user's active skills using
 * the Anthropic API. Batches emails for efficient LLM usage and
 * returns structured classification results.
 */

import { getClient } from '../anthropic/client.js';
import { getEmailSkillStore } from './sqlite.js';
import { getMemoryStore } from '../memory/index.js';
import { buildClassifierPrompt } from './prompt.js';
import config from '../../config.js';
import type { IncomingEmail, ClassificationResult, SkillMatch } from './types.js';

/** Maximum emails per LLM call */
const BATCH_SIZE = 5;

/**
 * Classify a list of incoming emails against the user's active skills.
 *
 * Returns classification results with matched skills, confidence scores,
 * and extracted data for each email.
 */
export async function classifyEmails(
  phoneNumber: string,
  emails: IncomingEmail[]
): Promise<ClassificationResult[]> {
  const skills = getEmailSkillStore().getSkillsForUser(phoneNumber, true);
  if (skills.length === 0) return [];

  const facts = await getMemoryStore().getFacts(phoneNumber);
  const factStrings = facts.map(f => f.fact);

  const systemPrompt = buildClassifierPrompt(skills, factStrings);

  // Process in batches
  const results: ClassificationResult[] = [];

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    const batchResults = await classifyBatch(systemPrompt, batch, i);

    if (batchResults) {
      results.push(...batchResults);
    }
  }

  return results;
}

/**
 * Classify a batch of emails with a single LLM call.
 * Returns null if parsing fails after retry.
 */
async function classifyBatch(
  systemPrompt: string,
  batch: IncomingEmail[],
  startIndex: number
): Promise<ClassificationResult[] | null> {
  const userMessage = batch.map((email, idx) => {
    const attachmentInfo = email.attachments.length > 0
      ? `\nAttachments: ${email.attachments.map(a => `${a.filename} (${a.mimeType}, ${a.sizeBytes} bytes)`).join(', ')}`
      : '';

    return `--- Email ${startIndex + idx + 1} ---
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}${attachmentInfo}

${email.body}`;
  }).join('\n\n');

  const anthropic = getClient();
  let attempts = 0;

  while (attempts < 2) {
    attempts++;
    try {
      const response = await anthropic.messages.create({
        model: config.emailWatcher.modelId,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from classifier');
      }

      const parsed = parseClassifierResponse(textBlock.text);
      return mapToClassificationResults(parsed, batch, startIndex);
    } catch (err) {
      if (attempts >= 2) {
        console.log(JSON.stringify({
          level: 'warn',
          message: 'Email classifier batch failed after retry',
          error: err instanceof Error ? err.message : String(err),
          batchStart: startIndex,
          batchSize: batch.length,
          timestamp: new Date().toISOString(),
        }));
        return null;
      }
    }
  }

  return null;
}

/**
 * Parse the JSON response from the classifier LLM.
 * Handles markdown code blocks and extracts the JSON array.
 */
function parseClassifierResponse(
  text: string
): Array<{ email_index: number; matches: Array<{ skill: string; confidence: number; extracted: Record<string, string | number | null>; summary: string }> }> {
  // Strip markdown code fences if present
  let jsonText = text.trim();
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  }

  // Handle single object response (wrap in array)
  if (jsonText.startsWith('{')) {
    jsonText = `[${jsonText}]`;
  }

  return JSON.parse(jsonText);
}

/**
 * Map parsed LLM output to ClassificationResult[], filtering by confidence threshold.
 */
function mapToClassificationResults(
  parsed: Array<{ email_index: number; matches: Array<{ skill: string; confidence: number; extracted: Record<string, string | number | null>; summary: string }> }>,
  batch: IncomingEmail[],
  startIndex: number
): ClassificationResult[] {
  const threshold = config.emailWatcher.confidenceThreshold;

  return parsed.map(entry => {
    const batchIdx = entry.email_index - startIndex - 1;
    const email = batch[batchIdx] ?? batch[0];

    const filteredMatches: SkillMatch[] = entry.matches
      .filter(m => m.confidence >= threshold)
      .map(m => ({
        skill: m.skill,
        confidence: m.confidence,
        extracted: m.extracted,
        summary: m.summary,
      }));

    return {
      emailIndex: entry.email_index,
      email,
      matches: filteredMatches,
    };
  });
}
