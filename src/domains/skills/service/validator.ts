/**
 * Skill frontmatter validator.
 * Validates required fields and Hermes-specific metadata.
 */
import type { SkillFrontmatter, SkillChannel } from '../types.js';

export type ValidationError = {
  field: string;
  message: string;
};

const VALID_CHANNELS: SkillChannel[] = ['sms', 'whatsapp', 'scheduler', 'email'];

/**
 * Validate skill frontmatter. Returns an array of errors (empty = valid).
 */
export function validateSkillFrontmatter(fm: SkillFrontmatter): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required fields
  if (!fm.name || typeof fm.name !== 'string') {
    errors.push({ field: 'name', message: 'name is required and must be a string' });
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(fm.name)) {
    errors.push({ field: 'name', message: 'name must be lowercase alphanumeric with hyphens (e.g., "receipt-summarizer")' });
  }

  if (!fm.description || typeof fm.description !== 'string') {
    errors.push({ field: 'description', message: 'description is required and must be a string' });
  }

  // Optional Hermes metadata validation
  if (fm.metadata?.hermes) {
    const hermes = fm.metadata.hermes;

    if (hermes.channels !== undefined) {
      if (!Array.isArray(hermes.channels)) {
        errors.push({ field: 'metadata.hermes.channels', message: 'channels must be an array' });
      } else {
        for (const ch of hermes.channels) {
          if (!VALID_CHANNELS.includes(ch as SkillChannel)) {
            errors.push({ field: 'metadata.hermes.channels', message: `invalid channel: ${ch}. Valid: ${VALID_CHANNELS.join(', ')}` });
          }
        }
      }
    }

    if (hermes.tools !== undefined && !Array.isArray(hermes.tools)) {
      errors.push({ field: 'metadata.hermes.tools', message: 'tools must be an array of strings' });
    } else if (Array.isArray(hermes.tools)) {
      for (const tool of hermes.tools) {
        if (typeof tool !== 'string' || tool.trim().length === 0) {
          errors.push({ field: 'metadata.hermes.tools', message: 'all tools entries must be non-empty strings' });
          break;
        }
      }
    }

    if (hermes.match !== undefined && !Array.isArray(hermes.match)) {
      errors.push({ field: 'metadata.hermes.match', message: 'match must be an array of strings' });
    } else if (Array.isArray(hermes.match)) {
      for (const hint of hermes.match) {
        if (typeof hint !== 'string' || hint.trim().length === 0) {
          errors.push({ field: 'metadata.hermes.match', message: 'all match entries must be non-empty strings' });
          break;
        }
      }
    }

    if (hermes.enabled !== undefined && typeof hermes.enabled !== 'boolean') {
      errors.push({ field: 'metadata.hermes.enabled', message: 'enabled must be a boolean' });
    }

    if (hermes.delegateAgent !== undefined && typeof hermes.delegateAgent !== 'string') {
      errors.push({ field: 'metadata.hermes.delegateAgent', message: 'delegateAgent must be a string' });
    }
  }

  return errors;
}
