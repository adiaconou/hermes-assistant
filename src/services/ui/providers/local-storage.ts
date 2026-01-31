/**
 * @fileoverview Local file-based storage provider for development.
 *
 * Stores generated HTML pages in the local filesystem under ./data/pages/.
 * Each page gets a UUID-based directory containing an index.html file.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { PageStorage } from './types.js';

/**
 * Local file storage provider for generated pages.
 *
 * Stores pages at: {basePath}/{pageId}/index.html
 *
 * @example
 * ```ts
 * const storage = new LocalFileStorage('./data/pages');
 * const { pageId, key } = await storage.upload('<html>...</html>');
 * const html = await storage.fetch(key);
 * ```
 */
export class LocalFileStorage implements PageStorage {
  private basePath: string;

  /**
   * Create a new local file storage provider.
   * @param basePath - Directory to store pages (default: ./data/pages)
   */
  constructor(basePath: string = './data/pages') {
    this.basePath = basePath;
  }

  /**
   * Upload HTML content to local storage.
   * Creates a new directory with a UUID and writes index.html.
   */
  async upload(html: string): Promise<{ pageId: string; key: string }> {
    const pageId = randomUUID();
    const key = `${pageId}/index.html`;
    const dirPath = join(this.basePath, pageId);
    const filePath = join(dirPath, 'index.html');

    // Ensure directory exists
    await mkdir(dirPath, { recursive: true });

    // Write HTML file
    await writeFile(filePath, html, 'utf-8');

    return { pageId, key };
  }

  /**
   * Fetch HTML content from local storage.
   * @param key - The storage key (path relative to basePath)
   * @throws If the file doesn't exist
   */
  async fetch(key: string): Promise<string> {
    const filePath = join(this.basePath, key);
    return readFile(filePath, 'utf-8');
  }
}
