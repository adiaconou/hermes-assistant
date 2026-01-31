/**
 * @fileoverview In-memory URL shortener with optional JSON persistence.
 *
 * Suitable for development. Entries can optionally survive restarts
 * if a persistence path is configured.
 */

import { randomBytes } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { UrlShortener, ShortUrlEntry } from './types.js';

/**
 * In-memory URL shortener with optional file persistence.
 *
 * @example
 * ```ts
 * // Without persistence (entries lost on restart)
 * const shortener = new MemoryShortener();
 *
 * // With persistence
 * const shortener = new MemoryShortener('./data/shortener.json');
 *
 * const id = await shortener.create('page-123', 'page-123/index.html', 7);
 * const resolved = await shortener.resolve(id);
 * ```
 */
export class MemoryShortener implements UrlShortener {
  private store = new Map<string, ShortUrlEntry>();
  private persistPath?: string;
  private loaded = false;

  /**
   * Create a new memory shortener.
   * @param persistPath - Optional path to JSON file for persistence
   */
  constructor(persistPath?: string) {
    this.persistPath = persistPath;
  }

  /**
   * Ensure data is loaded from persistence file (if configured).
   * Only loads once per instance.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded || !this.persistPath) return;

    try {
      const data = await readFile(this.persistPath, 'utf-8');
      const entries = JSON.parse(data) as Record<string, ShortUrlEntry>;
      const now = Date.now();

      // Load non-expired entries
      for (const [id, entry] of Object.entries(entries)) {
        if (entry.expiresAt > now) {
          this.store.set(id, entry);
        }
      }
    } catch {
      // File doesn't exist yet, that's fine
    }

    this.loaded = true;
  }

  /**
   * Persist current entries to file (if configured).
   */
  private async persist(): Promise<void> {
    if (!this.persistPath) return;

    const entries: Record<string, ShortUrlEntry> = {};
    for (const [id, entry] of this.store.entries()) {
      entries[id] = entry;
    }

    await mkdir(dirname(this.persistPath), { recursive: true });
    await writeFile(this.persistPath, JSON.stringify(entries, null, 2));
  }

  /**
   * Create a new short URL mapping.
   * @param pageId - The page identifier
   * @param key - The storage key for the page
   * @param ttlDays - Time-to-live in days
   * @returns Short URL identifier (~80 bits of randomness)
   */
  async create(pageId: string, key: string, ttlDays: number): Promise<string> {
    await this.ensureLoaded();

    const id = randomBytes(10).toString('base64url'); // ~80 bits
    const now = Date.now();
    const entry: ShortUrlEntry = {
      pageId,
      key,
      createdAt: now,
      expiresAt: now + ttlDays * 24 * 60 * 60 * 1000,
    };

    this.store.set(id, entry);
    await this.persist();

    return id;
  }

  /**
   * Resolve a short URL to its page info.
   * @param id - The short URL identifier
   * @returns Page info if found and not expired, null otherwise
   */
  async resolve(id: string): Promise<{ pageId: string; key: string } | null> {
    await this.ensureLoaded();

    const entry = this.store.get(id);
    if (!entry) return null;

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.store.delete(id);
      await this.persist();
      return null;
    }

    return { pageId: entry.pageId, key: entry.key };
  }

  /**
   * Get the number of active (non-expired) entries.
   * Useful for debugging/monitoring.
   */
  async getActiveCount(): Promise<number> {
    await this.ensureLoaded();
    const now = Date.now();
    let count = 0;
    for (const entry of this.store.values()) {
      if (entry.expiresAt > now) count++;
    }
    return count;
  }
}
