/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for the shared tool helpers module.
 */

import { describe, it, expect } from 'vitest';
import { json, jsonError, type ToolResult } from '../../../src/tools/common/helpers.js';

describe('common/helpers', () => {
  describe('json', () => {
    it('should format data as a successful tool result', () => {
      const result = json({ key: 'value' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual({ key: 'value' });
    });

    it('should pretty-print JSON with 2 spaces', () => {
      const result = json({ a: 1, b: 2 });
      const text = result.content[0].text;

      expect(text).toBe(JSON.stringify({ a: 1, b: 2 }, null, 2));
    });

    it('should handle null data', () => {
      const result = json(null);

      expect(JSON.parse(result.content[0].text)).toBeNull();
    });

    it('should handle array data', () => {
      const result = json([1, 2, 3]);

      expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
    });

    it('should handle nested objects', () => {
      const data = { a: { b: { c: 'deep' } } };
      const result = json(data);

      expect(JSON.parse(result.content[0].text)).toEqual(data);
    });

    it('should handle string data', () => {
      const result = json('hello');

      expect(JSON.parse(result.content[0].text)).toBe('hello');
    });
  });

  describe('jsonError', () => {
    it('should format an error with isError flag', () => {
      const result = jsonError('Something went wrong');

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Something went wrong');
    });

    it('should include details when provided', () => {
      const result = jsonError('Auth error', { userOpenId: 'ou_123' });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Auth error');
      expect(parsed.details).toEqual({ userOpenId: 'ou_123' });
    });

    it('should handle details as undefined', () => {
      const result = jsonError('Error without details');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Error without details');
      expect(parsed.details).toBeUndefined();
    });
  });

  describe('ToolResult type', () => {
    it('should be compatible with MCP SDK expectations', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'hello' }],
        isError: false,
      };

      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBe(false);
    });

    it('should allow optional isError', () => {
      const result: ToolResult = {
        content: [{ type: 'text', text: 'test' }],
      };

      expect(result.isError).toBeUndefined();
    });
  });
});
