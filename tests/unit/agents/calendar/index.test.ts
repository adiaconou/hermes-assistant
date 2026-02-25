/**
 * Unit tests for Calendar agent.
 *
 * Tests the agent capability definition is correct.
 */

import { describe, it, expect } from 'vitest';
import { capability } from '../../../../src/domains/calendar/runtime/agent.js';

describe('calendar agent', () => {
  describe('capability definition', () => {
    it('should have correct agent name', () => {
      expect(capability.name).toBe('calendar-agent');
    });

    it('should have description mentioning Calendar', () => {
      expect(capability.description).toContain('Calendar');
    });

    it('should include all calendar tools', () => {
      expect(capability.tools).toContain('get_calendar_events');
      expect(capability.tools).toContain('create_calendar_event');
      expect(capability.tools).toContain('update_calendar_event');
      expect(capability.tools).toContain('delete_calendar_event');
      expect(capability.tools).toContain('resolve_date');
    });

    it('should have exactly 5 tools', () => {
      expect(capability.tools).toHaveLength(5);
    });

    it('should have relevant examples', () => {
      expect(capability.examples.length).toBeGreaterThan(0);
      expect(capability.examples.some(e => e.toLowerCase().includes('calendar'))).toBe(true);
      expect(capability.examples.some(e => e.toLowerCase().includes('schedule'))).toBe(true);
    });
  });
});
