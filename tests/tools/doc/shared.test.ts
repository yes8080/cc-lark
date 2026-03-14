/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for Doc tools shared utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMcpEndpoint,
  unwrapJsonRpcResult,
  json,
  jsonError,
  processMcpResult,
  type McpRpcSuccess,
  type McpRpcError,
} from '../../../src/tools/doc/shared.js';

describe('doc/shared', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.FEISHU_MCP_ENDPOINT;
    delete process.env.FEISHU_MCP_BEARER_TOKEN;
    delete process.env.FEISHU_MCP_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getMcpEndpoint', () => {
    it('should return default endpoint when no env var is set', () => {
      expect(getMcpEndpoint()).toBe('https://mcp.feishu.cn/mcp');
    });

    it('should return custom endpoint from env var', () => {
      process.env.FEISHU_MCP_ENDPOINT = 'https://custom.mcp.com/endpoint';
      expect(getMcpEndpoint()).toBe('https://custom.mcp.com/endpoint');
    });

    it('should trim whitespace from env var', () => {
      process.env.FEISHU_MCP_ENDPOINT = '  https://custom.mcp.com/endpoint  ';
      expect(getMcpEndpoint()).toBe('https://custom.mcp.com/endpoint');
    });
  });

  describe('unwrapJsonRpcResult', () => {
    it('should return non-object values unchanged', () => {
      expect(unwrapJsonRpcResult('string')).toBe('string');
      expect(unwrapJsonRpcResult(123)).toBe(123);
      expect(unwrapJsonRpcResult(null)).toBe(null);
    });

    it('should return non-JSON-RPC objects unchanged', () => {
      const data = { foo: 'bar', baz: 123 };
      expect(unwrapJsonRpcResult(data)).toEqual(data);
    });

    it('should unwrap JSON-RPC success response', () => {
      const response: McpRpcSuccess = {
        jsonrpc: '2.0',
        id: 1,
        result: { data: 'test' },
      };
      expect(unwrapJsonRpcResult(response)).toEqual({ data: 'test' });
    });

    it('should recursively unwrap nested JSON-RPC responses', () => {
      const nestedResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          jsonrpc: '2.0',
          id: 2,
          result: { data: 'nested' },
        },
      };
      expect(unwrapJsonRpcResult(nestedResponse)).toEqual({ data: 'nested' });
    });

    it('should throw error for JSON-RPC error response', () => {
      const response: McpRpcError = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' },
      };
      expect(() => unwrapJsonRpcResult(response)).toThrow('Invalid Request');
    });

    it('should throw generic error for malformed JSON-RPC error', () => {
      const response = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600 },
      };
      expect(() => unwrapJsonRpcResult(response)).toThrow('MCP returned error');
    });

    it('should unwrap result-only wrapper', () => {
      const wrapper = {
        result: { data: 'test' },
      };
      expect(unwrapJsonRpcResult(wrapper)).toEqual({ data: 'test' });
    });
  });

  describe('json', () => {
    it('should format a successful result', () => {
      const result = json({ foo: 'bar', num: 123 });
      expect(result).toEqual({
        content: [{ type: 'text', text: '{\n  "foo": "bar",\n  "num": 123\n}' }],
      });
      expect(result.isError).toBeUndefined();
    });

    it('should handle null data', () => {
      const result = json(null);
      expect(result).toEqual({
        content: [{ type: 'text', text: 'null' }],
      });
    });
  });

  describe('jsonError', () => {
    it('should format an error result', () => {
      const result = jsonError('Something went wrong');
      expect(result).toEqual({
        content: [{ type: 'text', text: '{\n  "error": "Something went wrong"\n}' }],
        isError: true,
      });
    });

    it('should format an error result with details', () => {
      const result = jsonError('Something went wrong', { code: 123 });
      expect(result).toEqual({
        content: [{ type: 'text', text: '{\n  "error": "Something went wrong",\n  "details": {\n    "code": 123\n  }\n}' }],
        isError: true,
      });
    });
  });

  describe('processMcpResult', () => {
    it('should process MCP content format', () => {
      const mcpResult = {
        content: [{ type: 'text', text: '{"title":"Test Doc"}' }],
      };
      const result = processMcpResult(mcpResult);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('{"title":"Test Doc"}');
    });

    it('should parse JSON text content', () => {
      const mcpResult = {
        content: [{ type: 'text', text: '{"title":"Test Doc","content":"Hello"}' }],
      };
      // processMcpResult doesn't change the text, it just formats for MCP response
      const result = processMcpResult(mcpResult);
      expect(result.content[0].text).toBe('{"title":"Test Doc","content":"Hello"}');
    });

    it('should handle multiple content items', () => {
      const mcpResult = {
        content: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
        ],
      };
      const result = processMcpResult(mcpResult);
      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toBe('First');
      expect(result.content[1].text).toBe('Second');
    });

    it('should handle non-MCP format results', () => {
      const data = { foo: 'bar' };
      const result = processMcpResult(data);
      expect(result.content[0].text).toBe('{\n  "foo": "bar"\n}');
    });
  });
});
