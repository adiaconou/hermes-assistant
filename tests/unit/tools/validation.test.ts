/**
 * Unit tests for validateInput utility.
 */

import { describe, it, expect } from 'vitest';
import { validateInput } from '../../../src/tools/utils.js';

describe('validateInput', () => {
  describe('required fields', () => {
    it('returns error when required field is missing', () => {
      const result = validateInput({}, {
        prompt: { type: 'string', required: true },
      });
      expect(result).toEqual({ success: false, error: 'prompt is required.' });
    });

    it('returns error when required field is null', () => {
      const result = validateInput({ prompt: null }, {
        prompt: { type: 'string', required: true },
      });
      expect(result).toEqual({ success: false, error: 'prompt is required.' });
    });

    it('returns error when required field is undefined', () => {
      const result = validateInput({ prompt: undefined }, {
        prompt: { type: 'string', required: true },
      });
      expect(result).toEqual({ success: false, error: 'prompt is required.' });
    });

    it('passes when required field is present', () => {
      const result = validateInput({ prompt: 'hello' }, {
        prompt: { type: 'string', required: true },
      });
      expect(result).toBeNull();
    });
  });

  describe('type checking', () => {
    it('rejects number where string expected', () => {
      const result = validateInput({ prompt: 123 }, {
        prompt: { type: 'string', required: true },
      });
      expect(result).toEqual({ success: false, error: 'prompt must be a string.' });
    });

    it('rejects string where number expected', () => {
      const result = validateInput({ max_results: 'ten' }, {
        max_results: { type: 'number', required: true },
      });
      expect(result).toEqual({ success: false, error: 'max_results must be a number.' });
    });

    it('rejects string where boolean expected', () => {
      const result = validateInput({ enabled: 'yes' }, {
        enabled: { type: 'boolean', required: true },
      });
      expect(result).toEqual({ success: false, error: 'enabled must be a boolean.' });
    });

    it('rejects non-array where array expected', () => {
      const result = validateInput({ values: 'not-array' }, {
        values: { type: 'array', required: true },
      });
      expect(result).toEqual({ success: false, error: 'values must be an array.' });
    });

    it('accepts array for array type', () => {
      const result = validateInput({ values: [1, 2, 3] }, {
        values: { type: 'array', required: true },
      });
      expect(result).toBeNull();
    });

    it('rejects array where object expected', () => {
      const result = validateInput({ data: [1, 2] }, {
        data: { type: 'object', required: true },
      });
      expect(result).toEqual({ success: false, error: 'data must be an object.' });
    });

    it('accepts object for object type', () => {
      const result = validateInput({ data: { key: 'value' } }, {
        data: { type: 'object', required: true },
      });
      expect(result).toBeNull();
    });
  });

  describe('non-empty string checking', () => {
    it('rejects empty required string by default', () => {
      const result = validateInput({ prompt: '' }, {
        prompt: { type: 'string', required: true },
      });
      expect(result).toEqual({ success: false, error: 'prompt must be a non-empty string.' });
    });

    it('rejects whitespace-only required string by default', () => {
      const result = validateInput({ prompt: '   ' }, {
        prompt: { type: 'string', required: true },
      });
      expect(result).toEqual({ success: false, error: 'prompt must be a non-empty string.' });
    });

    it('allows empty string when nonEmpty is explicitly false', () => {
      const result = validateInput({ query: '' }, {
        query: { type: 'string', required: true, nonEmpty: false },
      });
      expect(result).toBeNull();
    });

    it('enforces nonEmpty on optional strings when explicitly set', () => {
      const result = validateInput({ query: '  ' }, {
        query: { type: 'string', required: false, nonEmpty: true },
      });
      expect(result).toEqual({ success: false, error: 'query must be a non-empty string.' });
    });
  });

  describe('optional fields', () => {
    it('passes when optional field is omitted', () => {
      const result = validateInput({}, {
        limit: { type: 'number', required: false },
      });
      expect(result).toBeNull();
    });

    it('passes when optional field is null', () => {
      const result = validateInput({ limit: null }, {
        limit: { type: 'number', required: false },
      });
      expect(result).toBeNull();
    });

    it('checks type when optional field is present', () => {
      const result = validateInput({ limit: 'ten' }, {
        limit: { type: 'number', required: false },
      });
      expect(result).toEqual({ success: false, error: 'limit must be a number.' });
    });

    it('passes when optional field has correct type', () => {
      const result = validateInput({ limit: 10 }, {
        limit: { type: 'number', required: false },
      });
      expect(result).toBeNull();
    });
  });

  describe('custom validators', () => {
    it('runs custom validator on valid type', () => {
      const result = validateInput({ max_results: -5 }, {
        max_results: {
          type: 'number',
          required: true,
          validate: (v) => (v as number) <= 0 ? 'max_results must be positive.' : null,
        },
      });
      expect(result).toEqual({ success: false, error: 'max_results must be positive.' });
    });

    it('passes custom validator when valid', () => {
      const result = validateInput({ max_results: 10 }, {
        max_results: {
          type: 'number',
          required: true,
          validate: (v) => (v as number) <= 0 ? 'max_results must be positive.' : null,
        },
      });
      expect(result).toBeNull();
    });
  });

  describe('multiple fields', () => {
    it('validates multiple fields and reports first error', () => {
      const result = validateInput({ schedule: 123 }, {
        prompt: { type: 'string', required: true },
        schedule: { type: 'string', required: true },
      });
      expect(result).toEqual({ success: false, error: 'prompt is required.' });
    });

    it('passes when all fields are valid', () => {
      const result = validateInput(
        { prompt: 'test', schedule: 'daily', limit: 10 },
        {
          prompt: { type: 'string', required: true },
          schedule: { type: 'string', required: true },
          limit: { type: 'number', required: false },
        }
      );
      expect(result).toBeNull();
    });
  });
});
