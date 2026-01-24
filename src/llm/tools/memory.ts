/**
 * Memory tools for storing and managing user facts.
 */

import type { ToolDefinition } from '../types.js';
import { requirePhoneNumber } from './utils.js';
import { getMemoryStore, type UserFact } from '../../services/memory/index.js';

export const extractMemory: ToolDefinition = {
  tool: {
    name: 'extract_memory',
    description: `Extract and store facts about the user from the conversation.

Use this when the user shares information about themselves that should be remembered:
- Personal details (name already handled by set_user_config, but other details)
- Preferences (food, communication style, etc.)
- Relationships (family, pets, colleagues)
- Health information (allergies, conditions)
- Work/life context (job, hobbies, routines)

Extract facts as atomic, self-contained sentences. Examples:
- "Likes black coffee"
- "Allergic to peanuts"
- "Has a dog named Max"
- "Works as software engineer"

IMPORTANT - Check <user_memory><facts> BEFORE extracting:
- Don't extract facts already present in memory
- Consider semantic equivalence: "Likes coffee" = "Prefers coffee" = "Drinks coffee"
- If fact exists with slight variation, skip it (don't extract duplicate)

Don't extract:
- Temporary information ("I'm busy today")
- Questions ("Should I...?")
- Facts already stored in <user_memory>`,
    input_schema: {
      type: 'object' as const,
      properties: {
        facts: {
          type: 'array',
          description: 'Array of facts to extract. Each fact should be a simple, atomic sentence.',
          items: {
            type: 'object',
            properties: {
              fact: {
                type: 'string',
                description: 'The fact as a concise sentence',
              },
              category: {
                type: 'string',
                description: 'Optional category: preferences, health, relationships, work, interests, etc.',
              },
            },
            required: ['fact'],
          },
        },
      },
      required: ['facts'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { facts } = input as {
      facts: Array<{
        fact: string;
        category?: string;
      }>;
    };

    try {
      const memoryStore = getMemoryStore();
      const now = Date.now();
      const addedFacts: UserFact[] = [];

      // Get existing facts for backup duplicate detection
      const existingFacts = await memoryStore.getFacts(phoneNumber);

      for (const factInput of facts) {
        // Backup duplicate detection: exact match, case-insensitive, trimmed
        const isDuplicate = existingFacts.some(
          existing => existing.fact.toLowerCase().trim() === factInput.fact.toLowerCase().trim()
        );

        if (isDuplicate) {
          console.log(JSON.stringify({
            level: 'info',
            message: 'Skipping duplicate fact (exact match)',
            fact: factInput.fact,
            timestamp: new Date().toISOString(),
          }));
          continue;
        }

        const fact = await memoryStore.addFact({
          phoneNumber,
          fact: factInput.fact,
          category: factInput.category,
          extractedAt: now,
        });
        addedFacts.push(fact);
      }

      console.log(JSON.stringify({
        level: 'info',
        message: 'Facts extracted',
        count: addedFacts.length,
        facts: addedFacts.map(f => ({
          id: f.id,
          fact: f.fact,
          category: f.category || 'uncategorized',
        })),
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        extracted_count: addedFacts.length,
        facts: addedFacts.map(f => ({ id: f.id, fact: f.fact })),
        memory_updated: addedFacts.length > 0,
      };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to extract memory',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const listMemories: ToolDefinition = {
  tool: {
    name: 'list_memories',
    description: 'Show what facts the assistant has remembered about the user. Use when user asks "what do you know about me", "show my facts", or "what have you remembered".',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  handler: async (_input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    try {
      const memoryStore = getMemoryStore();
      const facts = await memoryStore.getFacts(phoneNumber);

      if (facts.length === 0) {
        return {
          success: true,
          count: 0,
          message: 'No memories stored yet.',
        };
      }

      const factList = facts.map(f => ({
        id: f.id,
        fact: f.fact,
        category: f.category || 'uncategorized',
        extractedAt: new Date(f.extractedAt).toLocaleString('en-US', {
          timeZone: context.userConfig?.timezone || 'UTC',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      }));

      return {
        success: true,
        count: facts.length,
        facts: factList,
      };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to list memories',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const updateMemory: ToolDefinition = {
  tool: {
    name: 'update_memory',
    description: 'Update an existing fact about the user when they correct or clarify something. Use when user says "Actually...", "I meant...", or provides new information that contradicts existing memory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fact_id: {
          type: 'string',
          description: 'The ID of the fact to update (from list_memories)',
        },
        new_fact: {
          type: 'string',
          description: 'The updated fact text (optional)',
        },
        category: {
          type: 'string',
          description: 'Updated category (optional)',
        },
      },
      required: ['fact_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { fact_id, new_fact, category } = input as {
      fact_id: string;
      new_fact?: string;
      category?: string;
    };

    try {
      const memoryStore = getMemoryStore();

      const updates: Partial<Omit<UserFact, 'id' | 'phoneNumber'>> = {};
      if (new_fact !== undefined) updates.fact = new_fact;
      if (category !== undefined) updates.category = category;

      await memoryStore.updateFact(fact_id, updates);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Fact updated',
        factId: fact_id,
        updates: Object.keys(updates),
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        fact_id,
        updated_fields: Object.keys(updates),
        memory_updated: true,
      };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to update memory',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const removeMemory: ToolDefinition = {
  tool: {
    name: 'remove_memory',
    description: 'Remove specific facts about the user when they ask to forget something. Use when user says "forget that", "delete that fact", or "don\'t remember X anymore".',
    input_schema: {
      type: 'object' as const,
      properties: {
        fact_ids: {
          type: 'array',
          description: 'IDs of facts to delete (from list_memories)',
          items: { type: 'string' },
        },
      },
      required: ['fact_ids'],
    },
  },
  handler: async (input, context) => {
    requirePhoneNumber(context);

    const { fact_ids } = input as { fact_ids: string[] };

    try {
      const memoryStore = getMemoryStore();

      for (const id of fact_ids) {
        await memoryStore.deleteFact(id);
      }

      console.log(JSON.stringify({
        level: 'info',
        message: 'Facts deleted',
        count: fact_ids.length,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        deleted_count: fact_ids.length,
        memory_updated: fact_ids.length > 0,
      };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to delete memories',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
