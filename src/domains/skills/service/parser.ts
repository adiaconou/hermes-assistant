/**
 * SKILL.md parser — extracts frontmatter and body from skill markdown files.
 */
import matter from 'gray-matter';
import type { SkillFrontmatter } from '../types.js';

export type ParseResult = {
  frontmatter: SkillFrontmatter;
  body: string;
};

/**
 * Parse a SKILL.md file's raw content into frontmatter and body.
 * Throws on invalid YAML or missing required fields.
 */
export function parseSkillMd(raw: string): ParseResult {
  const { data, content } = matter(raw);

  if (!data || typeof data !== 'object') {
    throw new Error('SKILL.md must have YAML frontmatter');
  }

  const frontmatter = data as SkillFrontmatter;

  return {
    frontmatter,
    body: content.trim(),
  };
}
