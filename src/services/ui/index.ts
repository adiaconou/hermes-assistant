/**
 * @fileoverview Main UI generation API.
 *
 * Provides a single entry point for generating dynamic UI pages:
 * 1. Validates LLM output (size limits, forbidden patterns)
 * 2. Wraps content in CSP security shell
 * 3. Stores the page using configured provider
 * 4. Creates a short URL for access
 */

import { randomUUID } from 'crypto';
import config from '../../config.js';
import { wrapWithSecurityShell, type GeneratedContent } from './generator.js';
import { validateOutput } from './validator.js';
import { getStorage, getShortener } from './provider-factory.js';

/**
 * Options for generating a page.
 */
export interface GeneratePageOptions {
  /** Page title */
  title: string;
  /** HTML body content (LLM-generated) */
  html: string;
  /** Optional CSS styles */
  css?: string;
  /** Optional JavaScript */
  js?: string;
  /** TTL in days (default: from config) */
  ttlDays?: number;
}

/**
 * Successful page generation result.
 */
export interface GeneratePageSuccess {
  /** Full short URL to access the page */
  shortUrl: string;
  /** Page identifier */
  pageId: string;
  /** Short URL identifier (without base URL) */
  shortId: string;
}

/**
 * Failed page generation result.
 */
export interface GeneratePageError {
  /** Error description */
  error: string;
}

/**
 * Result of page generation.
 */
export type GeneratePageResult = GeneratePageSuccess | GeneratePageError;

/**
 * Type guard for successful generation.
 */
export function isSuccess(result: GeneratePageResult): result is GeneratePageSuccess {
  return 'shortUrl' in result;
}

/**
 * Type guard for failed generation.
 */
export function isError(result: GeneratePageResult): result is GeneratePageError {
  return 'error' in result;
}

/**
 * Generate a dynamic UI page from LLM output.
 *
 * @param options - Page content and metadata
 * @returns Short URL and page ID on success, or error message
 *
 * @example
 * ```ts
 * const result = await generatePage({
 *   title: 'Grocery List',
 *   html: '<ul><li>Chicken</li><li>Rice</li></ul>',
 *   js: 'document.querySelectorAll("li").forEach(li => { ... })',
 * });
 *
 * if (isSuccess(result)) {
 *   console.log('Page created:', result.shortUrl);
 * } else {
 *   console.error('Failed:', result.error);
 * }
 * ```
 */
export async function generatePage(
  options: GeneratePageOptions
): Promise<GeneratePageResult> {
  const ttlDays = options.ttlDays ?? config.ui.pageTtlDays;

  // Step 1: Validate LLM output
  const validation = validateOutput({
    html: options.html,
    css: options.css,
    js: options.js,
  });

  if (!validation.valid) {
    return { error: validation.reason };
  }

  // Step 2: Generate page ID for localStorage namespacing
  const pageId = randomUUID();

  // Step 3: Wrap content in security shell
  const content: GeneratedContent = {
    html: options.html,
    css: options.css,
    js: options.js,
  };
  const wrappedHtml = wrapWithSecurityShell(content, options.title, pageId);

  // Step 4: Store the page
  const storage = getStorage();
  const { key } = await storage.upload(wrappedHtml);

  // Step 5: Create short URL
  const shortener = getShortener();
  const shortId = await shortener.create(pageId, key, ttlDays);
  const shortUrl = `${config.baseUrl}/u/${shortId}`;

  return { shortUrl, pageId, shortId };
}

// Re-export types and utilities for convenience
export { CSP_POLICY, type GeneratedContent } from './generator.js';
export { validateOutput, getSizeLimits, type ValidationResult } from './validator.js';
export { getStorage, getShortener, resetProviders } from './provider-factory.js';
