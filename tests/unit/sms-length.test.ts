/**
 * Unit tests for SMS length enforcement.
 */

import { describe, it, expect } from 'vitest';
import { enforceSmsLength } from '../../src/routes/sms.js';

describe('enforceSmsLength', () => {
  describe('SMS channel', () => {
    it('returns message unchanged when under 160 chars', () => {
      const message = 'Hello, this is a short message.';
      const result = enforceSmsLength(message, 'sms');

      expect(result).toBe(message);
    });

    it('returns message unchanged when exactly 160 chars', () => {
      const message = 'A'.repeat(160);
      const result = enforceSmsLength(message, 'sms');

      expect(result).toBe(message);
      expect(result.length).toBe(160);
    });

    it('returns canned acknowledgment when over 160 chars', () => {
      const message = 'A'.repeat(200);
      const result = enforceSmsLength(message, 'sms');

      expect(result).toBe("Working on your request. I'll send the full response shortly.");
      expect(result.length).toBeLessThanOrEqual(160);
    });

    it('returns canned acknowledgment for very long messages', () => {
      const message = 'A'.repeat(10000);
      const result = enforceSmsLength(message, 'sms');

      expect(result).toBe("Working on your request. I'll send the full response shortly.");
    });

    it('returns canned acknowledgment for message at 161 chars', () => {
      const message = 'A'.repeat(161);
      const result = enforceSmsLength(message, 'sms');

      expect(result).toBe("Working on your request. I'll send the full response shortly.");
    });

    it('handles empty message', () => {
      const result = enforceSmsLength('', 'sms');
      expect(result).toBe('');
    });
  });

  describe('WhatsApp channel', () => {
    it('returns message unchanged for short messages', () => {
      const message = 'Hello, this is a short message.';
      const result = enforceSmsLength(message, 'whatsapp');

      expect(result).toBe(message);
    });

    it('returns message unchanged for messages over 160 chars', () => {
      const message = 'A'.repeat(200);
      const result = enforceSmsLength(message, 'whatsapp');

      expect(result).toBe(message);
      expect(result.length).toBe(200);
    });

    it('returns message unchanged for very long messages', () => {
      const message = 'A'.repeat(1000);
      const result = enforceSmsLength(message, 'whatsapp');

      expect(result).toBe(message);
      expect(result.length).toBe(1000);
    });

    it('handles empty message', () => {
      const result = enforceSmsLength('', 'whatsapp');
      expect(result).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles message with unicode characters (SMS)', () => {
      // Unicode chars may take multiple bytes but we count characters
      const message = '🎉'.repeat(50); // 50 emoji = 50 chars
      const result = enforceSmsLength(message, 'sms');

      // 50 chars is under 160, should return unchanged
      expect(result).toBe(message);
    });

    it('handles message with unicode characters over limit (SMS)', () => {
      const message = '🎉'.repeat(200); // 200 emoji = 200 chars
      const result = enforceSmsLength(message, 'sms');

      expect(result).toBe("Working on your request. I'll send the full response shortly.");
    });

    it('handles message with newlines (SMS)', () => {
      const message = 'Line1\nLine2\nLine3';
      const result = enforceSmsLength(message, 'sms');

      expect(result).toBe(message);
    });

    it('handles message with newlines over limit (SMS)', () => {
      const message = ('Line\n').repeat(50); // 250 chars
      const result = enforceSmsLength(message, 'sms');

      expect(result).toBe("Working on your request. I'll send the full response shortly.");
    });
  });
});
