/**
 * @fileoverview Gemini Vision service.
 */

import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import config from '../../../config.js';
import { GeminiNotConfiguredError } from '../types.js';

function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = config.google.geminiApiKey;
  if (!apiKey) {
    throw new GeminiNotConfiguredError();
  }
  return new GoogleGenerativeAI(apiKey);
}

export async function analyzeImage(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string
): Promise<string> {
  const client = getGeminiClient();
  const model = client.getGenerativeModel({
    model: config.google.geminiModel || 'gemini-2.0-flash',
  });

  const base64Data = imageBuffer.toString('base64');

  const imagePart: Part = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };

  console.log(JSON.stringify({
    level: 'info',
    message: 'Analyzing image with Gemini',
    mimeType,
    imageSizeBytes: imageBuffer.length,
    promptLength: prompt.length,
    model: config.google.geminiModel || 'gemini-2.0-flash',
    timestamp: new Date().toISOString(),
  }));

  const startTime = Date.now();

  try {
    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();

    console.log(JSON.stringify({
      level: 'info',
      message: 'Gemini analysis complete',
      responseLength: text.length,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    return text;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Gemini analysis failed',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));
    throw error;
  }
}

export const ANALYSIS_PROMPTS = {
  identifyDocument: `What type of document is this? Provide a brief description of its contents.
Be specific - if it's a receipt, say what store and approximate amount. If it's a business card, mention the person's name. If it's a screenshot, describe what app or content is shown.`,
  extractText: `Extract all visible text from this image. Preserve the layout and structure as much as possible.`,
  extractReceipt: `Extract data from this receipt in JSON format with the following structure:
{
  "store_name": "string",
  "date": "YYYY-MM-DD or null if not visible",
  "total": number or null,
  "currency": "USD" or appropriate currency code,
  "items": [{"name": "string", "price": number}],
  "payment_method": "string or null",
  "category": "one of: groceries, restaurant, gas, shopping, entertainment, utilities, healthcare, travel, other"
}
Only include fields you can confidently extract. Use null for uncertain values.`,
  extractBusinessCard: `Extract contact information from this business card in JSON format:
{
  "name": "string",
  "title": "string or null",
  "company": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "website": "string or null",
  "address": "string or null"
}
Only include fields you can confidently extract.`,
  describe: `Describe what is shown in this image. Be concise but thorough.`,
};

export function isAnalyzableImage(contentType: string): boolean {
  return contentType.startsWith('image/');
}
