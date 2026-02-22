/**
 * Unit tests for skill frontmatter validator.
 */

import { describe, it, expect } from 'vitest';
import { validateSkillFrontmatter } from '../../../src/domains/skills/service/validator.js';
import type { SkillFrontmatter } from '../../../src/domains/skills/types.js';

function validFrontmatter(overrides: Partial<SkillFrontmatter> = {}): SkillFrontmatter {
  return {
    name: 'my-skill',
    description: 'A valid skill',
    ...overrides,
  };
}

describe('validateSkillFrontmatter', () => {
  it('returns empty errors for valid frontmatter', () => {
    const errors = validateSkillFrontmatter(validFrontmatter());
    expect(errors).toEqual([]);
  });

  it('returns error when name is missing', () => {
    const errors = validateSkillFrontmatter(validFrontmatter({ name: '' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('name');
  });

  it('returns error when name is not a string', () => {
    const errors = validateSkillFrontmatter(validFrontmatter({ name: 123 as unknown as string }));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('name');
  });

  it('returns error when description is missing', () => {
    const errors = validateSkillFrontmatter(validFrontmatter({ description: '' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('description');
  });

  it('returns error when description is not a string', () => {
    const errors = validateSkillFrontmatter(validFrontmatter({ description: 42 as unknown as string }));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('description');
  });

  it('returns error for uppercase name', () => {
    const errors = validateSkillFrontmatter(validFrontmatter({ name: 'MySkill' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('name');
    expect(errors[0].message).toContain('lowercase');
  });

  it('returns error for name with spaces', () => {
    const errors = validateSkillFrontmatter(validFrontmatter({ name: 'my skill' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('name');
  });

  it('returns error for name starting with hyphen', () => {
    const errors = validateSkillFrontmatter(validFrontmatter({ name: '-my-skill' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('name');
  });

  it('returns error for invalid channel', () => {
    const fm = validFrontmatter({
      metadata: { hermes: { channels: ['sms', 'telegram' as never] } },
    });
    const errors = validateSkillFrontmatter(fm);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('metadata.hermes.channels');
    expect(errors[0].message).toContain('telegram');
  });

  it('passes for valid Hermes metadata', () => {
    const fm = validFrontmatter({
      metadata: {
        hermes: {
          channels: ['sms', 'whatsapp'],
          tools: ['vision'],
          match: ['receipt'],
          enabled: true,
          delegateAgent: 'vision-agent',
        },
      },
    });
    const errors = validateSkillFrontmatter(fm);
    expect(errors).toEqual([]);
  });

  it('returns error when tools is not an array', () => {
    const fm = validFrontmatter({
      metadata: { hermes: { tools: 'vision' as unknown as string[] } },
    });
    const errors = validateSkillFrontmatter(fm);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('metadata.hermes.tools');
  });

  it('returns error when tools contains non-string entries', () => {
    const fm = validFrontmatter({
      metadata: { hermes: { tools: ['read_email', 42 as unknown as string] } },
    });
    const errors = validateSkillFrontmatter(fm);
    expect(errors.some(e => e.field === 'metadata.hermes.tools')).toBe(true);
  });

  it('returns error when match is not an array', () => {
    const fm = validFrontmatter({
      metadata: { hermes: { match: 'receipt' as unknown as string[] } },
    });
    const errors = validateSkillFrontmatter(fm);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('metadata.hermes.match');
  });

  it('returns error when match contains non-string entries', () => {
    const fm = validFrontmatter({
      metadata: { hermes: { match: ['invoice', true as unknown as string] } },
    });
    const errors = validateSkillFrontmatter(fm);
    expect(errors.some(e => e.field === 'metadata.hermes.match')).toBe(true);
  });

  it('returns error when enabled is not a boolean', () => {
    const fm = validFrontmatter({
      metadata: { hermes: { enabled: 'yes' as unknown as boolean } },
    });
    const errors = validateSkillFrontmatter(fm);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('metadata.hermes.enabled');
  });

  it('returns error when channels is not an array', () => {
    const fm = validFrontmatter({
      metadata: { hermes: { channels: 'sms' as unknown as never } },
    });
    const errors = validateSkillFrontmatter(fm);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('metadata.hermes.channels');
    expect(errors[0].message).toContain('must be an array');
  });

  it('returns multiple errors for multiple invalid fields', () => {
    const fm = { name: '', description: '' } as SkillFrontmatter;
    const errors = validateSkillFrontmatter(fm);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const fields = errors.map(e => e.field);
    expect(fields).toContain('name');
    expect(fields).toContain('description');
  });
});
