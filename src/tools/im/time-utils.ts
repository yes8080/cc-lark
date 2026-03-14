/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Time utilities for IM tools.
 *
 * Provides time range parsing and ISO 8601 conversion utilities.
 * Adapted from openclaw-lark for MCP Server architecture.
 */

const BJ_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8

// ===========================================================================
// ISO 8601 ↔ Unix conversion utilities
// ===========================================================================

/** Format a Date as Beijing time ISO 8601 string */
function formatBeijingISO(d: Date): string {
  const bj = new Date(d.getTime() + BJ_OFFSET_MS);
  const y = bj.getUTCFullYear();
  const mo = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const da = String(bj.getUTCDate()).padStart(2, '0');
  const h = String(bj.getUTCHours()).padStart(2, '0');
  const mi = String(bj.getUTCMinutes()).padStart(2, '0');
  const s = String(bj.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}:${s}+08:00`;
}

// ---------------------------------------------------------------------------
// Unix seconds → ISO 8601
// ---------------------------------------------------------------------------

/** Convert Unix seconds (number) to ISO 8601 Beijing time */
export function secondsToDateTime(seconds: number): string {
  return formatBeijingISO(new Date(seconds * 1000));
}

/** Convert Unix seconds (string) to ISO 8601 Beijing time */
export function secondsStringToDateTime(seconds: string): string {
  return secondsToDateTime(parseInt(seconds, 10));
}

// ---------------------------------------------------------------------------
// Unix milliseconds → ISO 8601
// ---------------------------------------------------------------------------

/** Convert Unix milliseconds (number) to ISO 8601 Beijing time */
export function millisToDateTime(millis: number): string {
  return formatBeijingISO(new Date(millis));
}

/** Convert Unix milliseconds (string) to ISO 8601 Beijing time */
export function millisStringToDateTime(millis: string): string {
  return millisToDateTime(parseInt(millis, 10));
}

// ---------------------------------------------------------------------------
// ISO 8601 → Unix
// ---------------------------------------------------------------------------

/** Convert ISO 8601 to Unix seconds (number) */
export function dateTimeToSeconds(datetime: string): number {
  const d = new Date(datetime);
  if (isNaN(d.getTime())) {
    throw new Error(
      `Unable to parse ISO 8601 time: "${datetime}". Example format: 2026-02-27T14:30:00+08:00`
    );
  }
  return Math.floor(d.getTime() / 1000);
}

/** Convert ISO 8601 to Unix seconds (string) */
export function dateTimeToSecondsString(datetime: string): string {
  return dateTimeToSeconds(datetime).toString();
}

/** Convert ISO 8601 to Unix milliseconds (number) */
export function dateTimeToMillis(datetime: string): number {
  const d = new Date(datetime);
  if (isNaN(d.getTime())) {
    throw new Error(
      `Unable to parse ISO 8601 time: "${datetime}". Example format: 2026-02-27T14:30:00+08:00`
    );
  }
  return d.getTime();
}

// ===========================================================================
// Time range parsing
// ===========================================================================

/** ISO 8601 time range */
export interface TimeRange {
  start: string;
  end: string;
}

/** Unix timestamp time range (seconds) */
export interface TimeRangeSeconds {
  start: string;
  end: string;
}

/**
 * Parse a time range identifier to ISO 8601 string pair.
 *
 * Supported formats:
 * - `today` / `yesterday` / `day_before_yesterday`
 * - `this_week` / `last_week` / `this_month` / `last_month`
 * - `last_{N}_{unit}` — unit: minutes / hours / days
 *
 * All calculations are based on Beijing time (UTC+8).
 */
export function parseTimeRange(input: string): TimeRange {
  const now = new Date();
  const bjNow = toBeijingDate(now);

  let start: Date;
  let end: Date;

  switch (input) {
    case 'today':
      start = beijingStartOfDay(bjNow);
      end = now;
      break;

    case 'yesterday': {
      const d = new Date(bjNow);
      d.setUTCDate(d.getUTCDate() - 1);
      start = beijingStartOfDay(d);
      end = beijingEndOfDay(d);
      break;
    }

    case 'day_before_yesterday': {
      const d = new Date(bjNow);
      d.setUTCDate(d.getUTCDate() - 2);
      start = beijingStartOfDay(d);
      end = beijingEndOfDay(d);
      break;
    }

    case 'this_week': {
      const day = bjNow.getUTCDay(); // 0=Sun .. 6=Sat
      const diffToMon = day === 0 ? 6 : day - 1;
      const monday = new Date(bjNow);
      monday.setUTCDate(monday.getUTCDate() - diffToMon);
      start = beijingStartOfDay(monday);
      end = now;
      break;
    }

    case 'last_week': {
      const day = bjNow.getUTCDay();
      const diffToMon = day === 0 ? 6 : day - 1;
      const thisMonday = new Date(bjNow);
      thisMonday.setUTCDate(thisMonday.getUTCDate() - diffToMon);
      const lastMonday = new Date(thisMonday);
      lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
      const lastSunday = new Date(thisMonday);
      lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
      start = beijingStartOfDay(lastMonday);
      end = beijingEndOfDay(lastSunday);
      break;
    }

    case 'this_month': {
      const firstDay = new Date(Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), 1));
      start = beijingStartOfDay(firstDay);
      end = now;
      break;
    }

    case 'last_month': {
      const firstDayThisMonth = new Date(Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), 1));
      const lastDayPrevMonth = new Date(firstDayThisMonth);
      lastDayPrevMonth.setUTCDate(lastDayPrevMonth.getUTCDate() - 1);
      const firstDayPrevMonth = new Date(
        Date.UTC(lastDayPrevMonth.getUTCFullYear(), lastDayPrevMonth.getUTCMonth(), 1)
      );
      start = beijingStartOfDay(firstDayPrevMonth);
      end = beijingEndOfDay(lastDayPrevMonth);
      break;
    }

    default: {
      // last_{N}_{unit} — only supports minutes / hours / days
      const match = input.match(/^last_(\d+)_(minutes?|hours?|days?)$/);
      if (!match) {
        throw new Error(
          `Unsupported relative_time format: "${input}". ` +
            'Supported: today, yesterday, day_before_yesterday, this_week, last_week, this_month, last_month, last_{N}_{unit} (unit: minutes/hours/days)'
        );
      }
      const n = parseInt(match[1], 10);
      const unit = match[2].replace(/s$/, ''); // normalize plural
      start = subtractFromNow(now, n, unit);
      end = now;
      break;
    }
  }

  return {
    start: formatBeijingISO(start),
    end: formatBeijingISO(end),
  };
}

/**
 * Parse a time range identifier to Unix seconds string pair.
 * This is for SDK API calls that require Unix timestamps.
 */
export function parseTimeRangeToSeconds(input: string): TimeRangeSeconds {
  const range = parseTimeRange(input);
  return {
    start: dateTimeToSecondsString(range.start),
    end: dateTimeToSecondsString(range.end),
  };
}

// ===========================================================================
// Internal helpers
// ===========================================================================

/** Convert UTC Date to "Beijing time components stored in UTC fields" Date */
function toBeijingDate(d: Date): Date {
  return new Date(d.getTime() + BJ_OFFSET_MS);
}

/** Beijing time start of day (00:00:00) as real UTC Date */
function beijingStartOfDay(bjDate: Date): Date {
  return new Date(Date.UTC(bjDate.getUTCFullYear(), bjDate.getUTCMonth(), bjDate.getUTCDate()) - BJ_OFFSET_MS);
}

/** Beijing time end of day (23:59:59) as real UTC Date */
function beijingEndOfDay(bjDate: Date): Date {
  return new Date(
    Date.UTC(bjDate.getUTCFullYear(), bjDate.getUTCMonth(), bjDate.getUTCDate(), 23, 59, 59) - BJ_OFFSET_MS
  );
}

function subtractFromNow(now: Date, n: number, unit: string): Date {
  const d = new Date(now);
  switch (unit) {
    case 'minute':
      d.setMinutes(d.getMinutes() - n);
      break;
    case 'hour':
      d.setHours(d.getHours() - n);
      break;
    case 'day':
      d.setDate(d.getDate() - n);
      break;
    default:
      throw new Error(`Unsupported time unit: ${unit}`);
  }
  return d;
}

// ===========================================================================
// Additional utilities for parsing various time formats
// ===========================================================================

/**
 * Parse a time string to Unix timestamp (seconds).
 *
 * Supports:
 * 1. ISO 8601 / RFC 3339 with timezone: "2024-01-01T00:00:00+08:00"
 * 2. Formats without timezone (defaults to Beijing time UTC+8):
 *    - "2026-02-25 14:30"
 *    - "2026-02-25 14:30:00"
 *    - "2026-02-25T14:30:00"
 *
 * Returns null if parsing fails.
 */
export function parseTimeToTimestamp(input: string): string | null {
  try {
    const trimmed = input.trim();

    // Check if timezone info is present (Z or +/- offset)
    const hasTimezone = /[Zz]$|[+-]\d{2}:\d{2}$/.test(trimmed);

    if (hasTimezone) {
      // Has timezone, parse directly
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return Math.floor(date.getTime() / 1000).toString();
    }

    // No timezone, treat as Beijing time
    const normalized = trimmed.replace('T', ' ');
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);

    if (!match) {
      // Try direct parse (might be other ISO 8601 format)
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return Math.floor(date.getTime() / 1000).toString();
    }

    const [, year, month, day, hour, minute, second] = match;
    // Treat as Beijing time (UTC+8), convert to UTC
    const utcDate = new Date(
      Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour) - 8, // Subtract 8 hours from Beijing time to get UTC
        parseInt(minute),
        parseInt(second ?? '0')
      )
    );

    return Math.floor(utcDate.getTime() / 1000).toString();
  } catch {
    return null;
  }
}

/**
 * Convert a Unix timestamp (seconds or milliseconds) to ISO 8601 string
 * in Asia/Shanghai timezone.
 *
 * Auto-detects seconds vs milliseconds based on magnitude.
 */
export function unixTimestampToISO8601(raw: string | number | undefined): string | null {
  if (raw === undefined || raw === null) return null;

  const text = typeof raw === 'number' ? String(raw) : String(raw).trim();
  if (!/^-?\d+$/.test(text)) return null;

  const num = Number(text);
  if (!Number.isFinite(num)) return null;

  const utcMs = Math.abs(num) >= 1e12 ? num : num * 1000;
  const beijingDate = new Date(utcMs + BJ_OFFSET_MS);
  if (Number.isNaN(beijingDate.getTime())) return null;

  const year = beijingDate.getUTCFullYear();
  const month = String(beijingDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getUTCDate()).padStart(2, '0');
  const hour = String(beijingDate.getUTCHours()).padStart(2, '0');
  const minute = String(beijingDate.getUTCMinutes()).padStart(2, '0');
  const second = String(beijingDate.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}
