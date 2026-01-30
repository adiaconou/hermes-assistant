/**
 * Unit tests for the agent registry module.
 *
 * Tests agent registration, lookup, and prompt formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agents module before importing registry
vi.mock('../../../src/agents/index.js', () => ({
  AGENTS: [
    {
      capability: {
        name: 'calendar-agent',
        description: 'Manages calendar events',
        tools: ['get_calendar_events', 'create_calendar_event'],
        examples: ['Check my calendar', 'Schedule a meeting'],
      },
    },
    {
      capability: {
        name: 'email-agent',
        description: 'Reads emails',
        tools: ['get_emails'],
        examples: ['Check my emails'],
      },
    },
    {
      capability: {
        name: 'general-agent',
        description: 'Handles general tasks',
        tools: ['*'],
        examples: ['Help me with something'],
      },
    },
  ],
}));

// Mock the router module
vi.mock('../../../src/executor/router.js', () => ({
  registerAgentExecutor: vi.fn(),
}));

import {
  createAgentRegistry,
  registerAgent,
  getAgentNames,
  formatAgentsForPrompt,
} from '../../../src/executor/registry.js';
import { registerAgentExecutor } from '../../../src/executor/router.js';

describe('createAgentRegistry', () => {
  it('should create a registry with all agents', () => {
    const registry = createAgentRegistry();
    const agents = registry.listAgents();

    expect(agents).toHaveLength(3);
    expect(agents.map(a => a.name)).toContain('calendar-agent');
    expect(agents.map(a => a.name)).toContain('email-agent');
    expect(agents.map(a => a.name)).toContain('general-agent');
  });

  it('should get agent by name', () => {
    const registry = createAgentRegistry();

    const calendarAgent = registry.getAgent('calendar-agent');
    expect(calendarAgent).toBeDefined();
    expect(calendarAgent?.name).toBe('calendar-agent');
    expect(calendarAgent?.description).toBe('Manages calendar events');
    expect(calendarAgent?.tools).toContain('get_calendar_events');
  });

  it('should return undefined for unknown agent', () => {
    const registry = createAgentRegistry();

    const unknown = registry.getAgent('unknown-agent');
    expect(unknown).toBeUndefined();
  });

  it('should return a copy of agents list', () => {
    const registry = createAgentRegistry();

    const agents1 = registry.listAgents();
    const agents2 = registry.listAgents();

    // Should be equal but not the same reference
    expect(agents1).toEqual(agents2);
    expect(agents1).not.toBe(agents2);
  });
});

describe('registerAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register agent without executor', () => {
    const newAgent = {
      name: 'scheduler-agent',
      description: 'Manages scheduled tasks',
      tools: ['create_scheduled_job'],
      examples: ['Set a reminder'],
    };

    // Note: This modifies the global agents array which persists between tests
    // In a real scenario, we'd want to reset this
    registerAgent(newAgent);

    expect(getAgentNames()).toContain('scheduler-agent');
    expect(registerAgentExecutor).not.toHaveBeenCalled();
  });

  it('should register agent with executor', () => {
    const newAgent = {
      name: 'test-agent',
      description: 'Test agent',
      tools: [],
      examples: [],
    };
    const mockExecutor = vi.fn();

    registerAgent(newAgent, mockExecutor);

    expect(registerAgentExecutor).toHaveBeenCalledWith('test-agent', mockExecutor);
  });
});

describe('getAgentNames', () => {
  it('should return all agent names', () => {
    const names = getAgentNames();

    expect(names).toContain('calendar-agent');
    expect(names).toContain('email-agent');
    expect(names).toContain('general-agent');
  });
});

describe('formatAgentsForPrompt', () => {
  it('should format agents with descriptions', () => {
    const registry = createAgentRegistry();
    const formatted = formatAgentsForPrompt(registry);

    expect(formatted).toContain('calendar-agent');
    expect(formatted).toContain('Manages calendar events');
    expect(formatted).toContain('email-agent');
    expect(formatted).toContain('Reads emails');
  });

  it('should include examples', () => {
    const registry = createAgentRegistry();
    const formatted = formatAgentsForPrompt(registry);

    expect(formatted).toContain('Examples:');
    expect(formatted).toContain('Check my calendar');
    expect(formatted).toContain('Schedule a meeting');
  });

  it('should format as bulleted list', () => {
    const registry = createAgentRegistry();
    const formatted = formatAgentsForPrompt(registry);

    // Each agent should start with "  - "
    const lines = formatted.split('\n').filter(l => l.includes('-agent'));
    expect(lines.every(l => l.trim().startsWith('-'))).toBe(true);
  });
});
