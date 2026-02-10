/**
 * Unit tests for Twilio media download service.
 *
 * Tests the media type validation and error handling.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  downloadTwilioMedia,
  isImageType,
  isAllowedMediaType,
  getMediaErrorMessage,
  UnsupportedMediaTypeError,
  MediaTooLargeError,
} from '../../../../src/services/twilio/media.js';

describe('twilio media service', () => {
  describe('isImageType', () => {
    it('should return true for image/jpeg', () => {
      expect(isImageType('image/jpeg')).toBe(true);
    });

    it('should return true for image/png', () => {
      expect(isImageType('image/png')).toBe(true);
    });

    it('should return true for image/gif', () => {
      expect(isImageType('image/gif')).toBe(true);
    });

    it('should return true for image/webp', () => {
      expect(isImageType('image/webp')).toBe(true);
    });

    it('should return true for image/heic', () => {
      expect(isImageType('image/heic')).toBe(true);
    });

    it('should return true for image/jpeg with parameters', () => {
      expect(isImageType('image/jpeg; charset=binary')).toBe(true);
    });

    it('should return false for application/pdf', () => {
      expect(isImageType('application/pdf')).toBe(false);
    });

    it('should return false for text/plain', () => {
      expect(isImageType('text/plain')).toBe(false);
    });
  });

  describe('isAllowedMediaType', () => {
    it('should allow image/jpeg', () => {
      expect(isAllowedMediaType('image/jpeg')).toBe(true);
    });

    it('should allow image/png', () => {
      expect(isAllowedMediaType('image/png')).toBe(true);
    });

    it('should allow image/gif', () => {
      expect(isAllowedMediaType('image/gif')).toBe(true);
    });

    it('should allow image/webp', () => {
      expect(isAllowedMediaType('image/webp')).toBe(true);
    });

    it('should allow image/heic', () => {
      expect(isAllowedMediaType('image/heic')).toBe(true);
    });

    it('should allow image/heif', () => {
      expect(isAllowedMediaType('image/heif')).toBe(true);
    });

    it('should allow image/jpg', () => {
      expect(isAllowedMediaType('image/jpg')).toBe(true);
    });

    it('should allow image/jpeg with parameters', () => {
      expect(isAllowedMediaType('image/jpeg; charset=binary')).toBe(true);
    });

    it('should allow application/pdf', () => {
      expect(isAllowedMediaType('application/pdf')).toBe(true);
    });

    it('should allow application/msword', () => {
      expect(isAllowedMediaType('application/msword')).toBe(true);
    });

    it('should allow docx', () => {
      expect(isAllowedMediaType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    });

    it('should not allow video/mp4', () => {
      expect(isAllowedMediaType('video/mp4')).toBe(false);
    });

    it('should not allow audio/mpeg', () => {
      expect(isAllowedMediaType('audio/mpeg')).toBe(false);
    });

    it('should not allow application/zip', () => {
      expect(isAllowedMediaType('application/zip')).toBe(false);
    });

    it('should not allow text/plain', () => {
      expect(isAllowedMediaType('text/plain')).toBe(false);
    });
  });

  describe('UnsupportedMediaTypeError', () => {
    it('should have correct error message', () => {
      const error = new UnsupportedMediaTypeError('video/mp4');
      expect(error.message).toContain('video/mp4');
      expect(error.message).toContain('Unsupported media type');
    });

    it('should store content type', () => {
      const error = new UnsupportedMediaTypeError('audio/wav');
      expect(error.contentType).toBe('audio/wav');
    });

    it('should have correct error name', () => {
      const error = new UnsupportedMediaTypeError('text/html');
      expect(error.name).toBe('UnsupportedMediaTypeError');
    });
  });

  describe('MediaTooLargeError', () => {
    it('should have correct error message', () => {
      const error = new MediaTooLargeError(15 * 1024 * 1024, 10 * 1024 * 1024);
      expect(error.message).toContain('15.00MB');
      expect(error.message).toContain('10.00MB');
    });

    it('should store size and max size', () => {
      const error = new MediaTooLargeError(20000000, 10000000);
      expect(error.size).toBe(20000000);
      expect(error.maxSize).toBe(10000000);
    });

    it('should have correct error name', () => {
      const error = new MediaTooLargeError(1000, 500);
      expect(error.name).toBe('MediaTooLargeError');
    });
  });

  describe('getMediaErrorMessage', () => {
    it('should return user-friendly message for UnsupportedMediaTypeError', () => {
      const error = new UnsupportedMediaTypeError('video/mp4');
      const message = getMediaErrorMessage(error);
      expect(message).toContain("can't process");
      expect(message).toContain('video/mp4');
    });

    it('should return user-friendly message for MediaTooLargeError', () => {
      const error = new MediaTooLargeError(15 * 1024 * 1024, 10 * 1024 * 1024);
      const message = getMediaErrorMessage(error);
      expect(message).toContain('too large');
      expect(message).toContain('10MB');
    });

    it('should return generic message for unknown errors', () => {
      const error = new Error('Network error');
      const message = getMediaErrorMessage(error);
      expect(message).toContain('trouble downloading');
    });
  });

  describe('downloadTwilioMedia retries', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('retries transient fetch failures and succeeds', async () => {
      let attempts = 0;
      vi.stubGlobal('fetch', vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          const transientError = new TypeError('fetch failed') as TypeError & {
            cause?: { code: string };
          };
          transientError.cause = { code: 'ECONNRESET' };
          throw transientError;
        }

        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': '3',
          },
        });
      }));

      const result = await downloadTwilioMedia('https://api.twilio.com/media/123');
      expect(result.contentType).toBe('image/jpeg');
      expect(result.size).toBe(3);
      expect(attempts).toBe(2);
    });

    it('does not retry non-retryable HTTP errors', async () => {
      const fetchMock = vi.fn(async () => new Response('not found', {
        status: 404,
        statusText: 'Not Found',
      }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(downloadTwilioMedia('https://api.twilio.com/media/404'))
        .rejects.toThrow('Failed to download media: 404 Not Found');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
