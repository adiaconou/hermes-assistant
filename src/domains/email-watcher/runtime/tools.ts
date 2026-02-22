/**
 * SMS-based email skill management tools.
 *
 * Six tools for creating, listing, updating, deleting, toggling,
 * and testing email watcher skills via the orchestrator.
 */

import type { ToolDefinition } from '../../../tools/types.js';
import { requirePhoneNumber, handleAuthError } from '../../../tools/utils.js';
import { getEmailSkillStore } from '../repo/sqlite.js';
import { getUserConfigStore } from '../../../services/user-config/index.js';
import { validateSkillDefinition } from '../service/skills.js';
import { syncNewEmails, prepareEmailForClassification } from '../providers/gmail-sync.js';
import { classifyEmails } from '../service/classifier.js';

export const createEmailSkill: ToolDefinition = {
  tool: {
    name: 'create_email_skill',
    description: `Create a new email watching skill. The skill will automatically match incoming emails and take action (log to spreadsheet or notify via SMS).

When creating a skill, generate a complete skill definition including:
- A slug-format name (lowercase, hyphens only)
- Clear match criteria describing what emails to watch for
- Fields to extract from matching emails
- Whether to log to a spreadsheet (execute_with_tools) or send a notification (notify)
- An action prompt describing what to do with matched emails`,
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Unique slug-format name (e.g., "job-applications", "package-tracking")',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of what this skill does',
        },
        match_criteria: {
          type: 'string',
          description: 'Natural language description of what emails to match (10-1000 chars)',
        },
        extract_fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Data fields to extract from matching emails (e.g., ["company", "position", "date"])',
        },
        action_type: {
          type: 'string',
          enum: ['execute_with_tools', 'notify'],
          description: '"execute_with_tools" to log to a spreadsheet/document, "notify" to send SMS notification',
        },
        action_prompt: {
          type: 'string',
          description: 'Instructions for what to do with matched emails (10-2000 chars)',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tool names to use (required for execute_with_tools). Allowed: find_spreadsheet, create_spreadsheet, read_spreadsheet, write_spreadsheet, append_to_spreadsheet, find_document, create_document, append_to_document',
        },
      },
      required: ['name', 'description', 'match_criteria', 'extract_fields', 'action_type', 'action_prompt'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const {
      name, description, match_criteria, extract_fields,
      action_type, action_prompt, tools,
    } = input as {
      name: string;
      description: string;
      match_criteria: string;
      extract_fields: string[];
      action_type: 'execute_with_tools' | 'notify';
      action_prompt: string;
      tools?: string[];
    };

    const skillData = {
      name,
      description,
      matchCriteria: match_criteria,
      extractFields: extract_fields,
      actionType: action_type,
      actionPrompt: action_prompt,
      tools: tools ?? [],
    };

    const errors = validateSkillDefinition(skillData);
    if (errors.length > 0) {
      return {
        success: false,
        errors: errors.map(e => `${e.field}: ${e.message}`),
      };
    }

    const store = getEmailSkillStore();

    // Check for duplicate name
    const existing = store.getSkillByName(phoneNumber, name);
    if (existing) {
      return {
        success: false,
        error: `A skill named "${name}" already exists. Use update_email_skill to modify it.`,
      };
    }

    const skill = store.createSkill({
      phoneNumber,
      name,
      description,
      matchCriteria: match_criteria,
      extractFields: extract_fields,
      actionType: action_type,
      actionPrompt: action_prompt,
      tools: tools ?? [],
      enabled: true,
    });

    return {
      success: true,
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        action_type: skill.actionType,
        enabled: skill.enabled,
      },
    };
  },
};

export const listEmailSkills: ToolDefinition = {
  tool: {
    name: 'list_email_skills',
    description: 'List all email watching skills for the current user. Shows skill names, status, match criteria, and action types.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  handler: async (_input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const store = getEmailSkillStore();
    const skills = store.getSkillsForUser(phoneNumber);

    if (skills.length === 0) {
      return {
        success: true,
        skills: [],
        message: 'No email skills configured. You can create one by describing what emails to watch for.',
      };
    }

    return {
      success: true,
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        match_criteria: s.matchCriteria,
        action_type: s.actionType,
        enabled: s.enabled,
        extract_fields: s.extractFields,
      })),
    };
  },
};

export const updateEmailSkill: ToolDefinition = {
  tool: {
    name: 'update_email_skill',
    description: 'Update an existing email watching skill by name. Can modify match criteria, extract fields, action type, action prompt, or tools.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name of the skill to update',
        },
        match_criteria: {
          type: 'string',
          description: 'Updated match criteria (optional)',
        },
        extract_fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated extract fields (optional)',
        },
        action_type: {
          type: 'string',
          enum: ['execute_with_tools', 'notify'],
          description: 'Updated action type (optional)',
        },
        action_prompt: {
          type: 'string',
          description: 'Updated action prompt (optional)',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated tool list (optional)',
        },
        description: {
          type: 'string',
          description: 'Updated description (optional)',
        },
      },
      required: ['name'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const {
      name, match_criteria, extract_fields,
      action_type, action_prompt, tools, description,
    } = input as {
      name: string;
      match_criteria?: string;
      extract_fields?: string[];
      action_type?: 'execute_with_tools' | 'notify';
      action_prompt?: string;
      tools?: string[];
      description?: string;
    };

    const store = getEmailSkillStore();
    const skill = store.getSkillByName(phoneNumber, name);
    if (!skill) {
      return { success: false, error: `Skill "${name}" not found` };
    }

    // Build updates and validate the merged result
    const updates: Partial<{
      matchCriteria: string;
      extractFields: string[];
      actionType: 'execute_with_tools' | 'notify';
      actionPrompt: string;
      tools: string[];
      description: string;
    }> = {};

    if (match_criteria !== undefined) updates.matchCriteria = match_criteria;
    if (extract_fields !== undefined) updates.extractFields = extract_fields;
    if (action_type !== undefined) updates.actionType = action_type;
    if (action_prompt !== undefined) updates.actionPrompt = action_prompt;
    if (tools !== undefined) updates.tools = tools;
    if (description !== undefined) updates.description = description;

    // Validate merged skill
    const merged = { ...skill, ...updates };
    const errors = validateSkillDefinition(merged);
    if (errors.length > 0) {
      return {
        success: false,
        errors: errors.map(e => `${e.field}: ${e.message}`),
      };
    }

    const updated = store.updateSkill(skill.id, updates);

    return {
      success: true,
      skill: {
        name: updated.name,
        description: updated.description,
        action_type: updated.actionType,
        enabled: updated.enabled,
      },
    };
  },
};

export const deleteEmailSkill: ToolDefinition = {
  tool: {
    name: 'delete_email_skill',
    description: 'Delete an email watching skill by name. This action cannot be undone.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name of the skill to delete',
        },
      },
      required: ['name'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { name } = input as { name: string };

    const store = getEmailSkillStore();
    const skill = store.getSkillByName(phoneNumber, name);
    if (!skill) {
      return { success: false, error: `Skill "${name}" not found` };
    }

    store.deleteSkill(skill.id);

    return {
      success: true,
      message: `Skill "${name}" has been deleted.`,
    };
  },
};

export const toggleEmailWatcher: ToolDefinition = {
  tool: {
    name: 'toggle_email_watcher',
    description: 'Enable or disable the email watcher for the current user. When disabled, no emails are processed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true to enable email watching, false to disable',
        },
      },
      required: ['enabled'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { enabled } = input as { enabled: boolean };

    const userConfigStore = getUserConfigStore();
    await userConfigStore.set(phoneNumber, { emailWatcherEnabled: enabled });

    return {
      success: true,
      email_watcher_enabled: enabled,
      message: enabled
        ? 'Email watching is now enabled. I will process your incoming emails.'
        : 'Email watching is now paused. No emails will be processed until re-enabled.',
    };
  },
};

export const testEmailSkill: ToolDefinition = {
  tool: {
    name: 'test_email_skill',
    description: 'Dry-run a skill against recent emails. Fetches the latest emails and classifies them without executing any actions. Shows which emails would match and what data would be extracted.',
    input_schema: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: 'Name of the skill to test (optional — tests all skills if omitted)',
        },
        max_emails: {
          type: 'number',
          description: 'Number of recent emails to test against (1-20, default 5)',
        },
      },
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { skill_name, max_emails = 5 } = input as {
      skill_name?: string;
      max_emails?: number;
    };

    const store = getEmailSkillStore();

    // Validate skill exists if specified
    if (skill_name) {
      const skill = store.getSkillByName(phoneNumber, skill_name);
      if (!skill) {
        return { success: false, error: `Skill "${skill_name}" not found` };
      }
    }

    try {
      // Fetch recent emails (reuses sync logic but doesn't update cursor)
      const { listEmails } = await import('../providers/email.js');
      const emails = await listEmails(phoneNumber, {
        maxResults: Math.min(Math.max(max_emails, 1), 20),
        query: 'is:inbox',
      });

      if (emails.length === 0) {
        return {
          success: true,
          message: 'No recent emails found to test against.',
          results: [],
        };
      }

      // Convert to IncomingEmail format for classifier
      const { google } = await import('googleapis');
      const { getAuthenticatedClient } = await import('../providers/google-core.js');

      const oauth2Client = await getAuthenticatedClient(phoneNumber, 'EmailWatcher');
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      const incomingEmails = [];
      for (const email of emails) {
        try {
          const response = await gmail.users.messages.get({
            userId: 'me',
            id: email.id,
            format: 'full',
          });
          if (response.data) {
            incomingEmails.push(prepareEmailForClassification(response.data));
          }
        } catch {
          // Skip emails we can't fetch
        }
      }

      if (incomingEmails.length === 0) {
        return {
          success: true,
          message: 'Could not fetch email content for testing.',
          results: [],
        };
      }

      // Run classifier
      const classifications = await classifyEmails(phoneNumber, incomingEmails);

      // Filter to specific skill if requested
      const results = classifications.map(c => ({
        email_subject: c.email.subject,
        email_from: c.email.from,
        email_date: c.email.date,
        matches: skill_name
          ? c.matches.filter(m => m.skill === skill_name)
          : c.matches,
      })).filter(r => r.matches.length > 0 || !skill_name);

      return {
        success: true,
        emails_tested: incomingEmails.length,
        results,
        note: 'This was a dry run. No actions were executed.',
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
