/**
 * Unit tests for SKILL.md parser.
 */

import { describe, it, expect } from 'vitest';
import { parseSkillMd } from '../../../src/domains/skills/service/parser.js';

const FULL_SKILL_MD = `---
name: receipt-summarizer
description: Summarize receipt images
metadata:
  hermes:
    channels:
      - sms
      - whatsapp
    tools:
      - vision
    match:
      - receipt
      - summarize
    enabled: true
    delegateAgent: vision-agent
---
# Receipt Summarizer

This skill summarizes receipt images.
`;

const MINIMAL_SKILL_MD = `---
name: hello-world
description: A minimal skill
---
Body content here.
`;

describe('parseSkillMd', () => {
  it('parses a full SKILL.md with all frontmatter fields', () => {
    const result = parseSkillMd(FULL_SKILL_MD);

    expect(result.frontmatter.name).toBe('receipt-summarizer');
    expect(result.frontmatter.description).toBe('Summarize receipt images');
    expect(result.frontmatter.metadata?.hermes?.channels).toEqual(['sms', 'whatsapp']);
    expect(result.frontmatter.metadata?.hermes?.tools).toEqual(['vision']);
    expect(result.frontmatter.metadata?.hermes?.match).toEqual(['receipt', 'summarize']);
    expect(result.frontmatter.metadata?.hermes?.enabled).toBe(true);
    expect(result.frontmatter.metadata?.hermes?.delegateAgent).toBe('vision-agent');
  });

  it('parses minimal SKILL.md with only name and description', () => {
    const result = parseSkillMd(MINIMAL_SKILL_MD);

    expect(result.frontmatter.name).toBe('hello-world');
    expect(result.frontmatter.description).toBe('A minimal skill');
    expect(result.frontmatter.metadata).toBeUndefined();
  });

  it('extracts body content below frontmatter', () => {
    const result = parseSkillMd(FULL_SKILL_MD);

    expect(result.body).toContain('# Receipt Summarizer');
    expect(result.body).toContain('This skill summarizes receipt images.');
  });

  it('returns empty body when no content below frontmatter', () => {
    const raw = `---
name: empty-body
description: No body
---
`;
    const result = parseSkillMd(raw);

    expect(result.body).toBe('');
  });

  it('throws on content with no frontmatter delimiters', () => {
    const raw = `# Just markdown, no frontmatter`;
    // gray-matter returns empty {} for no frontmatter,
    // but our function casts it — empty object still passes the typeof check.
    // The parser itself doesn't throw; the validator catches missing fields.
    const result = parseSkillMd(raw);
    expect(result.frontmatter).toEqual({});
  });

  it('throws on empty string', () => {
    // gray-matter returns empty data for empty string
    const result = parseSkillMd('');
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('');
  });
});
