/**
 * Calendar domain capability descriptor.
 */

export const calendarCapability = {
  domain: 'calendar',
  exposure: 'agent',
  agentId: 'calendar-agent',
  tools: [
    'get_calendar_events',
    'create_calendar_event',
    'update_calendar_event',
    'delete_calendar_event',
    'resolve_date',
  ],
} as const;
