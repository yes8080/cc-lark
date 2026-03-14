/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for IM tools time utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  secondsToDateTime,
  secondsStringToDateTime,
  millisToDateTime,
  millisStringToDateTime,
  dateTimeToSeconds,
  dateTimeToSecondsString,
  dateTimeToMillis,
  parseTimeRange,
  parseTimeRangeToSeconds,
  parseTimeToTimestamp,
  unixTimestampToISO8601,
} from '../../../src/tools/im/time-utils.js';

// 2026-03-14 20:00:00+08:00 = 2026-03-14 12:00:00 UTC
const TEST_TIMESTAMP_SECONDS = 1773489600;
const TEST_TIMESTAMP_MILLIS = 1773489600000;
const TEST_ISO = '2026-03-14T20:00:00+08:00';

describe('time-utils', () => {
  describe('secondsToDateTime', () => {
    it('should convert Unix seconds to ISO 8601 Beijing time', () => {
      const result = secondsToDateTime(TEST_TIMESTAMP_SECONDS);
      expect(result).toBe(TEST_ISO);
    });

    it('should handle epoch', () => {
      const result = secondsToDateTime(0);
      expect(result).toBe('1970-01-01T08:00:00+08:00');
    });
  });

  describe('secondsStringToDateTime', () => {
    it('should convert Unix seconds string to ISO 8601', () => {
      const result = secondsStringToDateTime(String(TEST_TIMESTAMP_SECONDS));
      expect(result).toBe(TEST_ISO);
    });
  });

  describe('millisToDateTime', () => {
    it('should convert Unix milliseconds to ISO 8601', () => {
      const result = millisToDateTime(TEST_TIMESTAMP_MILLIS);
      expect(result).toBe(TEST_ISO);
    });
  });

  describe('millisStringToDateTime', () => {
    it('should convert Unix milliseconds string to ISO 8601', () => {
      const result = millisStringToDateTime(String(TEST_TIMESTAMP_MILLIS));
      expect(result).toBe(TEST_ISO);
    });
  });

  describe('dateTimeToSeconds', () => {
    it('should convert ISO 8601 to Unix seconds', () => {
      const result = dateTimeToSeconds(TEST_ISO);
      expect(result).toBe(TEST_TIMESTAMP_SECONDS);
    });

    it('should throw for invalid date format', () => {
      expect(() => dateTimeToSeconds('invalid')).toThrow();
    });
  });

  describe('dateTimeToSecondsString', () => {
    it('should convert ISO 8601 to Unix seconds string', () => {
      const result = dateTimeToSecondsString(TEST_ISO);
      expect(result).toBe(String(TEST_TIMESTAMP_SECONDS));
    });
  });

  describe('dateTimeToMillis', () => {
    it('should convert ISO 8601 to Unix milliseconds', () => {
      const result = dateTimeToMillis(TEST_ISO);
      expect(result).toBe(TEST_TIMESTAMP_MILLIS);
    });
  });

  describe('parseTimeRange', () => {
    it('should parse "today"', () => {
      const result = parseTimeRange('today');
      expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\+08:00$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    });

    it('should parse "yesterday"', () => {
      const result = parseTimeRange('yesterday');
      expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\+08:00$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59\+08:00$/);
    });

    it('should parse "this_week"', () => {
      const result = parseTimeRange('this_week');
      expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\+08:00$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    });

    it('should parse "this_month"', () => {
      const result = parseTimeRange('this_month');
      expect(result.start).toMatch(/^\d{4}-\d{2}-01T00:00:00\+08:00$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    });

    it('should parse "last_3_days"', () => {
      const result = parseTimeRange('last_3_days');
      expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    });

    it('should parse "last_60_minutes"', () => {
      const result = parseTimeRange('last_60_minutes');
      expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    });

    it('should throw for unsupported format', () => {
      expect(() => parseTimeRange('invalid')).toThrow();
    });
  });

  describe('parseTimeRangeToSeconds', () => {
    it('should return Unix seconds for time range', () => {
      const result = parseTimeRangeToSeconds('today');
      expect(result.start).toMatch(/^\d+$/);
      expect(result.end).toMatch(/^\d+$/);
    });
  });

  describe('parseTimeToTimestamp', () => {
    it('should parse ISO 8601 with timezone', () => {
      const result = parseTimeToTimestamp(TEST_ISO);
      expect(result).toBe(String(TEST_TIMESTAMP_SECONDS));
    });

    it('should parse ISO 8601 without timezone (default to Beijing)', () => {
      // 2026-03-14 20:00 Beijing = same as above
      const result = parseTimeToTimestamp('2026-03-14 20:00');
      expect(result).toBe(String(TEST_TIMESTAMP_SECONDS));
    });

    it('should parse ISO 8601 with T separator without timezone', () => {
      const result = parseTimeToTimestamp('2026-03-14T20:00:00');
      expect(result).toBe(String(TEST_TIMESTAMP_SECONDS));
    });

    it('should return null for invalid format', () => {
      expect(parseTimeToTimestamp('invalid')).toBeNull();
    });
  });

  describe('unixTimestampToISO8601', () => {
    it('should convert Unix seconds to ISO 8601', () => {
      const result = unixTimestampToISO8601(TEST_TIMESTAMP_SECONDS);
      expect(result).toBe(TEST_ISO);
    });

    it('should convert Unix milliseconds to ISO 8601', () => {
      const result = unixTimestampToISO8601(TEST_TIMESTAMP_MILLIS);
      expect(result).toBe(TEST_ISO);
    });

    it('should return null for undefined', () => {
      expect(unixTimestampToISO8601(undefined)).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(unixTimestampToISO8601('invalid')).toBeNull();
    });
  });
});
