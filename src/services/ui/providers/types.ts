/**
 * @fileoverview Provider interfaces for UI generation storage.
 */

/**
 * Entry stored in the URL shortener.
 */
export type ShortUrlEntry = {
  pageId: string;
  key: string;
  createdAt: number;
  expiresAt: number;
};

/**
 * Storage provider for generated HTML pages.
 */
export interface PageStorage {
  /**
   * Upload HTML content and return identifiers.
   * @param html - The complete HTML document to store
   * @returns pageId and storage key for retrieval
   */
  upload(html: string): Promise<{ pageId: string; key: string }>;

  /**
   * Fetch HTML content by storage key.
   * @param key - The storage key returned from upload()
   * @returns The HTML content
   * @throws If the key doesn't exist or storage fails
   */
  fetch(key: string): Promise<string>;
}

/**
 * URL shortener provider for page links.
 */
export interface UrlShortener {
  /**
   * Create a short URL mapping.
   * @param pageId - The page identifier
   * @param key - The storage key for the page
   * @param ttlDays - Time-to-live in days
   * @returns The short URL identifier (not the full URL)
   */
  create(pageId: string, key: string, ttlDays: number): Promise<string>;

  /**
   * Resolve a short URL to its page info.
   * @param id - The short URL identifier
   * @returns Page info if found and not expired, null otherwise
   */
  resolve(id: string): Promise<{ pageId: string; key: string } | null>;
}
