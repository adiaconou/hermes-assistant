/**
 * @fileoverview Factory for creating storage and shortener providers.
 *
 * Reads configuration to determine which provider implementations to use.
 * Supports local development (file storage + memory) and production (S3 + Redis).
 */

import type { PageStorage, UrlShortener } from './providers/types.js';
import { LocalFileStorage } from './providers/local-storage.js';
import { MemoryShortener } from './providers/memory-shortener.js';
import config from '../config.js';

// Singleton instances
let storageInstance: PageStorage | null = null;
let shortenerInstance: UrlShortener | null = null;

/**
 * Get the configured page storage provider.
 *
 * Returns a singleton instance based on UI_STORAGE_PROVIDER config:
 * - 'local': LocalFileStorage (writes to ./data/pages)
 * - 's3': S3Storage (Phase 4b - not yet implemented)
 *
 * @throws If an unknown provider is configured or S3 is requested before implementation
 */
export function getStorage(): PageStorage {
  if (!storageInstance) {
    const provider = config.ui.storageProvider;

    switch (provider) {
      case 'local':
        storageInstance = new LocalFileStorage(config.ui.localStoragePath);
        break;

      case 's3':
        // Phase 4b: Uncomment when S3 provider is implemented
        // import { S3Storage } from './providers/s3-storage.js';
        // storageInstance = new S3Storage({
        //   region: config.aws.region,
        //   bucket: config.aws.s3Bucket!,
        // });
        throw new Error(
          'S3 storage provider not yet implemented. ' +
            'Set UI_STORAGE_PROVIDER=local for development.'
        );

      default:
        throw new Error(`Unknown storage provider: ${provider}`);
    }
  }

  return storageInstance;
}

/**
 * Get the configured URL shortener provider.
 *
 * Returns a singleton instance based on UI_SHORTENER_PROVIDER config:
 * - 'memory': MemoryShortener (in-memory with optional JSON persistence)
 * - 'redis': RedisShortener (Phase 4b - not yet implemented)
 *
 * @throws If an unknown provider is configured or Redis is requested before implementation
 */
export function getShortener(): UrlShortener {
  if (!shortenerInstance) {
    const provider = config.ui.shortenerProvider;

    switch (provider) {
      case 'memory':
        shortenerInstance = new MemoryShortener(config.ui.shortenerPersistPath);
        break;

      case 'redis':
        // Phase 4b: Uncomment when Redis provider is implemented
        // import { RedisShortener } from './providers/redis-shortener.js';
        // shortenerInstance = new RedisShortener(config.redis.url!);
        throw new Error(
          'Redis shortener provider not yet implemented. ' +
            'Set UI_SHORTENER_PROVIDER=memory for development.'
        );

      default:
        throw new Error(`Unknown shortener provider: ${provider}`);
    }
  }

  return shortenerInstance;
}

/**
 * Reset provider instances. Useful for testing.
 */
export function resetProviders(): void {
  storageInstance = null;
  shortenerInstance = null;
}
