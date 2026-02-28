/**
 * @fileoverview Shared date resolution utilities (single dates + ranges).
 *
 * Uses chrono-node for natural language parsing with Luxon for timezone handling.
 */

import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import { createLogger } from '../../utils/observability/index.js';

const log = createLogger({ domain: 'date-resolver' });

export type ResolvedDate = {
  timestamp: number; // UTC Unix timestamp (seconds)
  iso: string; // ISO 8601 with timezone offset
  formatted: string; // Human-readable in user's timezone
  components: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
};

export type ResolvedDateRange = {
  start: ResolvedDate;
  end: ResolvedDate;
  granularity: 'day' | 'week' | 'month' | 'custom';
};

export type ResolveDateOptions = {
  timezone: string; // IANA timezone (required)
  referenceDate?: Date; // For testing, defaults to now
  forwardDate?: boolean; // Prefer future dates (default: true)
};

/**
 * Patterns that indicate explicit range syntax (from X to Y, between X and Y).
 * These are handled specially to extract start/end components.
 */
const EXPLICIT_RANGE_PATTERNS = [
  /\bfrom\s+.+\s+to\s+.+/i,
  /\bbetween\s+.+\s+and\s+.+/i,
];

/**
 * Period patterns that represent spans of time requiring boundary calculation.
 * Map pattern to: [granularity, offset from current period]
 * offset: 0 = this, 1 = next, -1 = last
 */
const PERIOD_CONFIG: Array<{
  pattern: RegExp;
  granularity: 'day' | 'week' | 'month';
  offset: number;
}> = [
  { pattern: /^today$/i, granularity: 'day', offset: 0 },
  { pattern: /^tomorrow$/i, granularity: 'day', offset: 1 },
  { pattern: /^yesterday$/i, granularity: 'day', offset: -1 },
  { pattern: /^this\s+week$/i, granularity: 'week', offset: 0 },
  { pattern: /^next\s+week$/i, granularity: 'week', offset: 1 },
  { pattern: /^last\s+week$/i, granularity: 'week', offset: -1 },
  { pattern: /^this\s+month$/i, granularity: 'month', offset: 0 },
  { pattern: /^next\s+month$/i, granularity: 'month', offset: 1 },
  { pattern: /^last\s+month$/i, granularity: 'month', offset: -1 },
];

function isExplicitRangeInput(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return EXPLICIT_RANGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function matchPeriodConfig(input: string): (typeof PERIOD_CONFIG)[number] | null {
  const normalized = input.trim();
  for (const config of PERIOD_CONFIG) {
    if (config.pattern.test(normalized)) {
      return config;
    }
  }
  return null;
}

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 7,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function parseNextWeekday(
  input: string,
  referenceDate: Date,
  timezone: string
): DateTime | null {
  const match = input.trim().toLowerCase().match(/^next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!match) {
    return null;
  }

  const weekday = WEEKDAY_MAP[match[1]];
  if (!weekday) {
    return null;
  }

  const refLocal = DateTime.fromJSDate(referenceDate, { zone: 'utc' }).setZone(timezone);
  const currentWeekday = refLocal.weekday; // 1=Mon .. 7=Sun
  let daysAhead = weekday - currentWeekday;
  if (daysAhead <= 0) {
    daysAhead += 7;
  }

  const results = chrono.parse(
    input,
    { instant: referenceDate, timezone: refLocal.offset },
    { forwardDate: true }
  );
  const parsed = results[0]?.start;
  const hour = parsed?.get('hour') ?? 0;
  const minute = parsed?.get('minute') ?? 0;
  const second = parsed?.get('second') ?? 0;

  const candidate = refLocal.plus({ days: daysAhead }).set({ hour, minute, second });
  return candidate.isValid ? candidate : null;
}

function requireValidTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    log.warn('invalid_timezone', { timezone });
    throw new Error(`Invalid timezone: "${timezone}"`);
  }
}

function getReferenceDate(options: ResolveDateOptions): Date {
  return options.referenceDate ?? new Date();
}

function toResolvedDate(dateTime: DateTime, timezone: string): ResolvedDate {
  const local = dateTime.setZone(timezone);
  const utc = local.toUTC();

  return {
    timestamp: Math.floor(utc.toSeconds()),
    iso: local.toISO({ suppressMilliseconds: true }) || utc.toISO({ suppressMilliseconds: true }) || '',
    formatted: formatInTimezone(utc.toJSDate(), timezone, 'long'),
    components: {
      year: local.year,
      month: local.month,
      day: local.day,
      hour: local.hour,
      minute: local.minute,
      second: local.second,
    },
  };
}

/**
 * Check if chrono parsed an explicit date (year, month, day all specified).
 * Used to determine whether forwardDate rejection should apply.
 */
function isExplicitDate(parsed: chrono.ParsedComponents): boolean {
  return parsed.isCertain('year') && parsed.isCertain('month') && parsed.isCertain('day');
}

/**
 * Parse natural language date/time into structured result.
 * Returns null if parsing fails.
 */
export function resolveDate(
  input: string,
  options: ResolveDateOptions
): ResolvedDate | null {
  if (!input || typeof input !== 'string') {
    log.debug('resolve_date_invalid_input', { reason: 'non_string_or_empty' });
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    log.debug('resolve_date_invalid_input', { reason: 'blank_string' });
    return null;
  }

  requireValidTimezone(options.timezone);

  // Ranges and periods should use resolveDateRange
  if (isExplicitRangeInput(trimmed) || matchPeriodConfig(trimmed)) {
    log.debug('resolve_date_rejected_range_input', { inputLength: trimmed.length });
    return null;
  }

  const forwardDate = options.forwardDate ?? true;
  const referenceDate = getReferenceDate(options);

  const nextWeekday = parseNextWeekday(trimmed, referenceDate, options.timezone);
  if (nextWeekday) {
    const resolved = toResolvedDate(nextWeekday, options.timezone);
    log.info('resolve_date_succeeded', {
      strategy: 'next_weekday',
      timezone: options.timezone,
      timestamp: resolved.timestamp,
    });
    return resolved;
  }

  const referenceUtc = DateTime.fromJSDate(referenceDate, { zone: 'utc' });
  const referenceLocal = referenceUtc.setZone(options.timezone);
  const offsetMinutes = referenceLocal.offset;

  const results = chrono.parse(
    trimmed,
    { instant: referenceDate, timezone: offsetMinutes },
    { forwardDate }
  );

  if (results.length === 0 || !results[0].start) {
    log.debug('resolve_date_no_match', {
      strategy: 'chrono',
      timezone: options.timezone,
      inputLength: trimmed.length,
    });
    return null;
  }

  // If chrono detected a range (has end), this should use resolveDateRange
  if (results[0].end) {
    log.debug('resolve_date_rejected_range_result', { timezone: options.timezone });
    return null;
  }

  const parsed = results[0].start;
  let localDateTime: DateTime | null = null;

  if (parsed.isCertain('timezoneOffset')) {
    localDateTime = DateTime.fromJSDate(parsed.date(), { zone: 'utc' }).setZone(options.timezone);
  } else {
    const year = parsed.get('year');
    const month = parsed.get('month');
    const day = parsed.get('day');
    const hour = parsed.get('hour');
    const minute = parsed.get('minute') ?? 0;
    const second = parsed.get('second') ?? 0;

    if (
      year != null &&
      month != null &&
      day != null &&
      hour != null
    ) {
      const candidate = DateTime.fromObject(
        { year, month, day, hour, minute, second },
        { zone: options.timezone }
      );

      if (!candidate.isValid) {
        return null;
      }

      if (
        candidate.year !== year ||
        candidate.month !== month ||
        candidate.day !== day ||
        candidate.hour !== hour ||
        candidate.minute !== minute
      ) {
        return null;
      }

      localDateTime = candidate;
    } else {
      localDateTime = DateTime.fromJSDate(parsed.date(), { zone: 'utc' }).setZone(options.timezone);
    }
  }

  if (!localDateTime || !localDateTime.isValid) {
    log.debug('resolve_date_invalid_result', { strategy: 'chrono', timezone: options.timezone });
    return null;
  }

  // Only reject past dates for AMBIGUOUS inputs (like "Monday" or "3pm").
  // Explicit dates (like "2026-02-04" or "January 15, 2026") should be accepted.
  const utcSeconds = localDateTime.toUTC().toSeconds();
  if (forwardDate && !isExplicitDate(parsed) && utcSeconds <= referenceUtc.toSeconds()) {
    log.debug('resolve_date_rejected_past_ambiguous', {
      timezone: options.timezone,
      inputLength: trimmed.length,
    });
    return null;
  }

  const resolved = toResolvedDate(localDateTime, options.timezone);
  log.info('resolve_date_succeeded', {
    strategy: 'chrono',
    timezone: options.timezone,
    timestamp: resolved.timestamp,
  });
  return resolved;
}

/**
 * Parse natural language date ranges like "this week", "next week",
 * "from 3pm to 5pm", "between Monday and Friday".
 *
 * Handles:
 * - Period patterns: today, tomorrow, yesterday, this/next/last week/month
 * - Explicit ranges: from X to Y, between X and Y
 * - Chrono-detected ranges (e.g., "Monday to Friday")
 */
export function resolveDateRange(
  input: string,
  options: ResolveDateOptions
): ResolvedDateRange | null {
  if (!input || typeof input !== 'string') {
    log.debug('resolve_range_invalid_input', { reason: 'non_string_or_empty' });
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    log.debug('resolve_range_invalid_input', { reason: 'blank_string' });
    return null;
  }

  requireValidTimezone(options.timezone);

  const referenceDate = getReferenceDate(options);
  const referenceLocal = DateTime.fromJSDate(referenceDate, { zone: 'utc' }).setZone(options.timezone);

  // Check for period patterns (today, this week, next month, etc.)
  const periodConfig = matchPeriodConfig(trimmed);
  if (periodConfig) {
    const { granularity, offset } = periodConfig;

    let base: DateTime;
    switch (granularity) {
      case 'day':
        base = referenceLocal.plus({ days: offset });
        break;
      case 'week':
        base = referenceLocal.plus({ weeks: offset });
        break;
      case 'month':
        base = referenceLocal.plus({ months: offset });
        break;
    }

    const start = base.startOf(granularity);
    const end = base.endOf(granularity);

    const resolvedRange: ResolvedDateRange = {
      start: toResolvedDate(start, options.timezone),
      end: toResolvedDate(end, options.timezone),
      granularity,
    };
    log.info('resolve_range_succeeded', {
      strategy: 'period',
      timezone: options.timezone,
      granularity,
      startTimestamp: resolvedRange.start.timestamp,
      endTimestamp: resolvedRange.end.timestamp,
    });
    return resolvedRange;
  }

  // Check for explicit range patterns (from X to Y, between X and Y)
  const fromMatch = trimmed.match(/\bfrom\s+(.+)\s+to\s+(.+)/i);
  const betweenMatch = trimmed.match(/\bbetween\s+(.+)\s+and\s+(.+)/i);
  const rangeMatch = fromMatch || betweenMatch;

  if (rangeMatch) {
    const startInput = rangeMatch[1]?.trim() || '';
    const endInput = rangeMatch[2]?.trim() || '';
    const start = resolveDate(startInput, {
      ...options,
      referenceDate,
    });
    if (!start) {
      return null;
    }
    const end = resolveDate(endInput, {
      ...options,
      referenceDate: new Date(start.timestamp * 1000),
    });
    if (!end || end.timestamp <= start.timestamp) {
      return null;
    }

    const resolvedRange: ResolvedDateRange = {
      start,
      end,
      granularity: 'custom',
    };
    log.info('resolve_range_succeeded', {
      strategy: 'explicit_range',
      timezone: options.timezone,
      granularity: resolvedRange.granularity,
      startTimestamp: resolvedRange.start.timestamp,
      endTimestamp: resolvedRange.end.timestamp,
    });
    return resolvedRange;
  }

  // Let chrono try to parse it as a range
  const offsetMinutes = referenceLocal.offset;
  const results = chrono.parse(
    trimmed,
    { instant: referenceDate, timezone: offsetMinutes },
    { forwardDate: options.forwardDate ?? true }
  );

  if (results.length > 0 && results[0].end) {
    const startDt = DateTime.fromJSDate(results[0].start.date(), { zone: 'utc' }).setZone(options.timezone);
    const endDt = DateTime.fromJSDate(results[0].end.date(), { zone: 'utc' }).setZone(options.timezone);

    if (startDt.isValid && endDt.isValid && endDt > startDt) {
      const resolvedRange: ResolvedDateRange = {
        start: toResolvedDate(startDt, options.timezone),
        end: toResolvedDate(endDt, options.timezone),
        granularity: 'custom',
      };
      log.info('resolve_range_succeeded', {
        strategy: 'chrono_range',
        timezone: options.timezone,
        granularity: resolvedRange.granularity,
        startTimestamp: resolvedRange.start.timestamp,
        endTimestamp: resolvedRange.end.timestamp,
      });
      return resolvedRange;
    }
  }

  log.debug('resolve_range_no_match', {
    timezone: options.timezone,
    inputLength: trimmed.length,
  });
  return null;
}

/**
 * Validate IANA timezone string.
 */
export function isValidTimezone(timezone: string): boolean {
  return DateTime.now().setZone(timezone).isValid;
}

/**
 * Get timezone offset in minutes for a given date and timezone.
 * Handles DST correctly.
 */
export function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const dt = DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) {
    throw new Error(`Invalid timezone: "${timezone}"`);
  }
  return dt.offset;
}

/**
 * Format a date in the user's timezone.
 */
export function formatInTimezone(
  date: Date,
  timezone: string,
  style: 'short' | 'long' = 'short'
): string {
  const dt = DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) {
    return date.toISOString();
  }
  const formatStyle = style === 'long' ? DateTime.DATETIME_FULL : DateTime.DATETIME_SHORT;
  return dt.toLocaleString(formatStyle);
}
