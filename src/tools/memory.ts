/**
 * Memory tools for storing and managing user facts.
 */

import type { ToolDefinition } from './types.js';
import { requirePhoneNumber } from './utils.js';
import { getMemoryStore } from '../services/memory/index.js';

/**
 * Extract a fact from recent conversation text.
 */
export const extractMemory: ToolDefinition = {
  tool: {
    name: 'extract_memory',
    description: 'Store a new fact about the user. Input should be a concise fact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fact: {
          type: 'string',
          description: 'Fact to store about the user',
        },
        category: {
          type: 'string',
          description: 'Optional category (preferences, interests, relationships, health, work, personal)',
        },
      },
      required: ['fact'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { fact, category } = input as { fact: string; category?: string };

    if (!fact || typeof fact !== 'string') {
      return { success: false, error: 'fact is required' };
    }

    const store = getMemoryStore();
    const saved = await store.addFact({
      phoneNumber,
      fact: fact.trim(),
      category,
      extractedAt: Date.now(),
    });

    return { success: true, fact: saved };
  },
};

/**
 * List stored facts.
 */
export const listMemories: ToolDefinition = {
  tool: {
    name: 'list_memories',
    description: 'List stored facts about the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of facts to return (default 20)',
        },
      },
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { limit = 20 } = input as { limit?: number };

    const store = getMemoryStore();
    const allFacts = await store.getFacts(phoneNumber);
    // Apply limit client-side since the interface doesn't support it
    const facts = allFacts.slice(0, Math.min(Math.max(limit ?? 20, 1), 100));

    return { success: true, facts };
  },
};

/**
 * Update a stored fact.
 */
export const updateMemory: ToolDefinition = {
  tool: {
    name: 'update_memory',
    description: 'Update an existing fact by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Fact ID' },
        fact: { type: 'string', description: 'New fact text' },
        category: { type: 'string', description: 'New category (optional)' },
      },
      required: ['id', 'fact'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { id, fact, category } = input as { id: string; fact: string; category?: string };

    const store = getMemoryStore();
    await store.updateFact(id, { fact: fact.trim(), category });

    // Return the updated fact (fetch it back)
    const allFacts = await store.getFacts(phoneNumber);
    const updated = allFacts.find(f => f.id === id);

    return { success: true, fact: updated };
  },
};

/**
 * Delete a stored fact.
 */
export const removeMemory: ToolDefinition = {
  tool: {
    name: 'remove_memory',
    description: 'Delete a stored fact by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Fact ID' },
      },
      required: ['id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { id } = input as { id: string };

    const store = getMemoryStore();
    await store.deleteFact(id);

    return { success: true, deleted: id };
  },
};
