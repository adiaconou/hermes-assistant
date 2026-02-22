/**
 * @fileoverview Email skill management and default skill seeding.
 *
 * Provides validation for user-created skills and seeds default skills
 * (tax-tracker, expense-tracker, invite-detector) when the email watcher
 * is initialized for a user.
 */

import { getEmailSkillStore } from '../repo/sqlite.js';
import { getUserConfigStore } from '../../../services/user-config/index.js';
import type { EmailSkill, SkillValidationError } from '../types.js';

/** Tools allowed in execute_with_tools skills */
const ALLOWED_SKILL_TOOLS = [
  'find_spreadsheet', 'create_spreadsheet', 'read_spreadsheet',
  'write_spreadsheet', 'append_to_spreadsheet',
  'find_document', 'create_document', 'append_to_document',
];

/** Default skill definitions seeded per-user on watcher init */
const DEFAULT_SKILLS: Array<Omit<EmailSkill, 'id' | 'phoneNumber' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'tax-tracker',
    description: 'Identify and log tax-related emails to a spreadsheet',
    matchCriteria: 'Tax-related emails: W-2 forms, 1099 forms, IRS correspondence, property tax statements, tax refund notices, tax preparation service communications, HSA/FSA tax documents, charitable donation receipts for tax purposes, mortgage interest statements',
    extractFields: ['date', 'vendor', 'document_type', 'tax_year', 'amount', 'description'],
    actionType: 'execute_with_tools',
    actionPrompt: 'Append a row to the "<year> Tax Documents" spreadsheet in the Hermes folder, where <year> is the tax year from the extracted data (not necessarily the current year — e.g., a W-2 received in Jan 2026 for tax year 2025 goes in "2025 Tax Documents"). If the spreadsheet doesn\'t exist, create it with headers: Date | Source | Type | Tax Year | Amount | Description | Email Subject. Before appending, read the last 10 rows and skip if a duplicate entry already exists (same source, type, and tax year). Use "N/A" for any missing fields.',
    tools: ['find_spreadsheet', 'create_spreadsheet', 'read_spreadsheet', 'append_to_spreadsheet'],
    enabled: true,
  },
  {
    name: 'expense-tracker',
    description: 'Identify and log expense-related emails to a spreadsheet',
    matchCriteria: 'Expense-related emails: purchase receipts, invoices, order confirmations, subscription charges, payment confirmations, billing statements, refund notices',
    extractFields: ['vendor', 'amount', 'date', 'category', 'description'],
    actionType: 'execute_with_tools',
    actionPrompt: 'Append a row to the "<year> Expenses" spreadsheet in the Hermes folder, where <year> is determined from the email/transaction date. If the spreadsheet doesn\'t exist, create it with headers: Date | Vendor | Amount | Category | Description | Email Subject. Before appending, read the last 10 rows and skip if a duplicate entry already exists (same vendor, amount, and date). Use "N/A" for any missing fields.',
    tools: ['find_spreadsheet', 'create_spreadsheet', 'read_spreadsheet', 'append_to_spreadsheet'],
    enabled: true,
  },
  {
    name: 'invite-detector',
    description: 'Detect calendar invitations and notify via SMS',
    matchCriteria: 'Calendar invitations, event invites, meeting requests, RSVP requests, conference registrations, webinar invitations. Not general "save the date" marketing.',
    extractFields: ['event_title', 'event_date', 'organizer', 'location'],
    actionType: 'notify',
    actionPrompt: 'Summarize the invitation: include event title, organizer, date/time, and location. Keep it to 1-2 sentences.',
    tools: [],
    enabled: true,
  },
];

/**
 * Seed default skills for a user if they don't already exist.
 */
export function seedDefaultSkills(phoneNumber: string): void {
  const store = getEmailSkillStore();
  const existing = store.getSkillsForUser(phoneNumber);

  for (const skill of DEFAULT_SKILLS) {
    if (!existing.some(s => s.name === skill.name)) {
      store.createSkill({ ...skill, phoneNumber });
    }
  }
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
 * to enabled and seeds default skills.
 */
export async function initEmailWatcherState(phoneNumber: string): Promise<void> {
  const userConfigStore = getUserConfigStore();
  await userConfigStore.set(phoneNumber, { emailWatcherEnabled: true });
  seedDefaultSkills(phoneNumber);
}
