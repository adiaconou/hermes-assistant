/**
 * @fileoverview Legacy email-skill compatibility helpers.
 *
 * Runtime email watcher behavior now uses filesystem skills only.
 * This module retains validation helpers and init wiring used by auth flow.
 */

import { getUserConfigStore } from '../../../services/user-config/index.js';
import type { EmailSkill, SkillValidationError } from '../types.js';

/** Tools allowed in execute_with_tools skills */
const ALLOWED_SKILL_TOOLS = [
  'find_spreadsheet', 'create_spreadsheet', 'read_spreadsheet',
  'write_spreadsheet', 'append_to_spreadsheet',
  'find_document', 'create_document', 'append_to_document',
];

/**
 * No-op kept for backwards compatibility.
 */
export function seedDefaultSkills(phoneNumber: string): void {
  console.log(JSON.stringify({
    level: 'info',
    message: 'seedDefaultSkills is deprecated; filesystem skills are managed on disk',
    phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Validate a skill definition before saving.
 *
 * Checks name format, field lengths, action type, tool allowlist,
 * and extract field limits.
 */
export function validateSkillDefinition(
  skill: Partial<EmailSkill>
): SkillValidationError[] {
  const errors: SkillValidationError[] = [];

  // name: required, 1-50 chars, slug format
  if (!skill.name) {
    errors.push({ field: 'name', message: 'Name is required' });
  } else if (skill.name.length > 50) {
    errors.push({ field: 'name', message: 'Name must be 50 characters or less' });
  } else if (!/^[a-z0-9-]+$/.test(skill.name)) {
    errors.push({ field: 'name', message: 'Name must be lowercase alphanumeric with hyphens only' });
  }

  // matchCriteria: required, 10-1000 chars
  if (!skill.matchCriteria) {
    errors.push({ field: 'matchCriteria', message: 'Match criteria is required' });
  } else if (skill.matchCriteria.length < 10) {
    errors.push({ field: 'matchCriteria', message: 'Match criteria must be at least 10 characters' });
  } else if (skill.matchCriteria.length > 1000) {
    errors.push({ field: 'matchCriteria', message: 'Match criteria must be 1000 characters or less' });
  }

  // actionType: must be valid
  if (!skill.actionType) {
    errors.push({ field: 'actionType', message: 'Action type is required' });
  } else if (skill.actionType !== 'execute_with_tools' && skill.actionType !== 'notify') {
    errors.push({ field: 'actionType', message: 'Action type must be "execute_with_tools" or "notify"' });
  }

  // actionPrompt: required, 10-2000 chars
  if (!skill.actionPrompt) {
    errors.push({ field: 'actionPrompt', message: 'Action prompt is required' });
  } else if (skill.actionPrompt.length < 10) {
    errors.push({ field: 'actionPrompt', message: 'Action prompt must be at least 10 characters' });
  } else if (skill.actionPrompt.length > 2000) {
    errors.push({ field: 'actionPrompt', message: 'Action prompt must be 2000 characters or less' });
  }

  // tools: if execute_with_tools, must be non-empty and from allowlist
  if (skill.actionType === 'execute_with_tools') {
    if (!skill.tools || skill.tools.length === 0) {
      errors.push({ field: 'tools', message: 'At least one tool is required for execute_with_tools action' });
    } else {
      const invalid = skill.tools.filter(t => !ALLOWED_SKILL_TOOLS.includes(t));
      if (invalid.length > 0) {
        errors.push({ field: 'tools', message: `Invalid tools: ${invalid.join(', ')}. Allowed: ${ALLOWED_SKILL_TOOLS.join(', ')}` });
      }
    }
  }

  // extractFields: max 20, each 1-50 chars
  if (skill.extractFields) {
    if (skill.extractFields.length > 20) {
      errors.push({ field: 'extractFields', message: 'Maximum 20 extract fields allowed' });
    }
    for (const field of skill.extractFields) {
      if (field.length < 1 || field.length > 50) {
        errors.push({ field: 'extractFields', message: `Extract field "${field}" must be 1-50 characters` });
        break;
      }
    }
  }

  return errors;
}

/**
 * Initialize email watcher state for a user.
 *
 * Called after successful Google OAuth. Sets the user's watcher
 * to enabled.
 */
export async function initEmailWatcherState(phoneNumber: string): Promise<void> {
  const userConfigStore = getUserConfigStore();
  await userConfigStore.set(phoneNumber, { emailWatcherEnabled: true });
}
