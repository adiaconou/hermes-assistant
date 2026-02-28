/**
 * Unit tests for OAuth state encryption/decryption with channel preservation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config before importing the module
vi.mock('../../src/config.js', () => ({
  default: {
    nodeEnv: 'test',
    baseUrl: 'https://example.com',
    oauth: {
      // Valid 64-character hex string (32 bytes)
      stateEncryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
    },
}));

// Import after mocking
import { encryptState, decryptState, generateAuthUrl } from '../../src/routes/auth.js';

describe('OAuth State Encryption', () => {
  describe('encryptState and decryptState', () => {
    it('encrypts and decrypts phone number correctly', () => {
      const phone = '+1234567890';
      const encrypted = encryptState(phone);
      const decrypted = decryptState(encrypted);

      expect(decrypted).not.toBeNull();
      expect(decrypted?.phone).toBe(phone);
    });

    it('preserves SMS channel through roundtrip', () => {
      const phone = '+1234567890';
      const encrypted = encryptState(phone, 'sms');
      const decrypted = decryptState(encrypted);

      expect(decrypted).not.toBeNull();
      expect(decrypted?.channel).toBe('sms');
    });

    it('preserves WhatsApp channel through roundtrip', () => {
      const phone = '+1234567890';
      const encrypted = encryptState(phone, 'whatsapp');
      const decrypted = decryptState(encrypted);

      expect(decrypted).not.toBeNull();
      expect(decrypted?.channel).toBe('whatsapp');
    });

    it('defaults to SMS channel when not specified', () => {
      const phone = '+1234567890';
      const encrypted = encryptState(phone);
      const decrypted = decryptState(encrypted);

      expect(decrypted).not.toBeNull();
      expect(decrypted?.channel).toBe('sms');
    });

    it('produces URL-safe base64 output', () => {
      const phone = '+1234567890';
      const encrypted = encryptState(phone, 'whatsapp');

      // URL-safe base64 should not contain +, /, or =
      expect(encrypted).not.toContain('+');
      expect(encrypted).not.toContain('/');
      // base64url may still have padding, but usually doesn't
      // The important thing is it's valid for URL usage
      expect(encrypted).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates different ciphertext for same input (random IV)', () => {
      const phone = '+1234567890';
      const encrypted1 = encryptState(phone, 'sms');
      const encrypted2 = encryptState(phone, 'sms');

      // Same plaintext should produce different ciphertext due to random IV
      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same values
      const decrypted1 = decryptState(encrypted1);
      const decrypted2 = decryptState(encrypted2);

      expect(decrypted1?.phone).toBe(decrypted2?.phone);
      expect(decrypted1?.channel).toBe(decrypted2?.channel);
    });

    it('returns null for tampered state', () => {
      const phone = '+1234567890';
      const encrypted = encryptState(phone, 'sms');

      // Tamper with the encrypted state
      const tampered = encrypted.slice(0, -5) + 'XXXXX';
      const decrypted = decryptState(tampered);

      expect(decrypted).toBeNull();
    });

    it('returns null for invalid base64', () => {
      const decrypted = decryptState('not-valid-base64!!!');
      expect(decrypted).toBeNull();
    });

    it('returns null for empty state', () => {
      const decrypted = decryptState('');
      expect(decrypted).toBeNull();
    });

    it('handles phone numbers with special characters', () => {
      const phone = '+1 (234) 567-8900';
      const encrypted = encryptState(phone, 'whatsapp');
      const decrypted = decryptState(encrypted);

      expect(decrypted).not.toBeNull();
      expect(decrypted?.phone).toBe(phone);
      expect(decrypted?.channel).toBe('whatsapp');
    });
  });

  describe('generateAuthUrl', () => {
    it('generates URL with encrypted state parameter', () => {
      const phone = '+1234567890';
      const url = generateAuthUrl(phone, 'sms');

      expect(url).toContain('https://example.com/auth/google?state=');

      // Extract state and verify it decrypts
      const stateMatch = url.match(/state=([^&]+)/);
      expect(stateMatch).not.toBeNull();

      const state = stateMatch![1];
      const decrypted = decryptState(state);

      expect(decrypted?.phone).toBe(phone);
      expect(decrypted?.channel).toBe('sms');
    });

    it('preserves WhatsApp channel in generated URL', () => {
      const phone = '+1234567890';
      const url = generateAuthUrl(phone, 'whatsapp');

      const stateMatch = url.match(/state=([^&]+)/);
      const state = stateMatch![1];
      const decrypted = decryptState(state);

      expect(decrypted?.channel).toBe('whatsapp');
    });

    it('defaults to SMS channel', () => {
      const phone = '+1234567890';
      const url = generateAuthUrl(phone);

      const stateMatch = url.match(/state=([^&]+)/);
      const state = stateMatch![1];
      const decrypted = decryptState(state);

      expect(decrypted?.channel).toBe('sms');
    });
  });

  describe('State expiry', () => {
    it('returns null for expired state', async () => {
      const phone = '+1234567890';

      // Create state
      const encrypted = encryptState(phone, 'sms');

      // Fast-forward time by 11 minutes (state expires in 10)
      const originalNow = Date.now;
      vi.spyOn(Date, 'now').mockImplementation(() => originalNow() + 11 * 60 * 1000);

      const decrypted = decryptState(encrypted);
      expect(decrypted).toBeNull();

      // Restore
      vi.restoreAllMocks();
    });

    it('accepts state within expiry window', () => {
      const phone = '+1234567890';

      // Create state
      const encrypted = encryptState(phone, 'sms');

      // Fast-forward time by 5 minutes (within 10 minute window)
      const originalNow = Date.now;
      vi.spyOn(Date, 'now').mockImplementation(() => originalNow() + 5 * 60 * 1000);

      const decrypted = decryptState(encrypted);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.phone).toBe(phone);

      // Restore
      vi.restoreAllMocks();
    });
  });
});
