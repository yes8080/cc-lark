/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for feishu_fetch_doc tool.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ToolRegistry } from '../../../src/tools/index.js';

// Mock the dependencies
vi.mock('../../../src/core/lark-client.js', () => ({
  LarkClient: {
    getInstance: vi.fn(() => ({
      sdk: {},
      config: { appId: 'test-app-id', appSecret: 'test-secret' },
    })),
  },
}));

vi.mock('../../../src/core/uat-client.js', () => ({
  getValidAccessToken: vi.fn(),
  NeedAuthorizationError: class NeedAuthorizationError extends Error {},
}));

vi.mock('../../../src/core/token-store.js', () => ({
  listStoredTokens: vi.fn(),
}));

vi.mock('../../../src/tools/doc/shared.js', () => ({
  callMcpTool: vi.fn(),
  json: (data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }),
  jsonError: (message: string, details?: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify({ error: message, details }, null, 2) }],
    isError: true,
  }),
  processMcpResult: (result: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }),
}));

// Import after mocking
import { registerFetchDocTool } from '../../../src/tools/doc/fetch.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../../src/core/uat-client.js';
import { listStoredTokens } from '../../../src/core/token-store.js';
import { callMcpTool } from '../../../src/tools/doc/shared.js';

describe('doc/fetch', () => {
  let registeredTools: Map<string, { handler: (args: unknown, context: unknown) => Promise<unknown> }>;
  let mockRegistry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools = new Map();
    mockRegistry = {
      register: vi.fn((def) => {
        registeredTools.set(def.name, { handler: def.handler });
      }),
    } as unknown as ToolRegistry;
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('registerFetchDocTool', () => {
    it('should register the tool with correct name', () => {
      registerFetchDocTool(mockRegistry);
      expect(registeredTools.has('feishu_fetch_doc')).toBe(true);
    });

    it('should have a description', () => {
      registerFetchDocTool(mockRegistry);
      const registration = vi.mocked(mockRegistry.register).mock.calls[0][0];
      expect(registration.description).toContain('Fetch Feishu document content');
    });
  });

  describe('handler', () => {
    it('should fail when LarkClient is null', async () => {
      registerFetchDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_fetch_doc');
      if (!tool) throw new Error('Tool not registered');

      const result = await tool.handler(
        { doc_id: 'doc_123' },
        { larkClient: null, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('LarkClient not initialized');
    });

    it('should fail when no user authorization', async () => {
      registerFetchDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_fetch_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([]);

      const result = await tool.handler(
        { doc_id: 'doc_123' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('No user authorization');
    });

    it('should call MCP tool with correct parameters', async () => {
      registerFetchDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_fetch_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({
        title: 'Test Document',
        content: '# Hello World\n\nThis is a test document.',
      });

      const result = await tool.handler(
        { doc_id: 'doc_123' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(callMcpTool).toHaveBeenCalledWith(
        'fetch-doc',
        { doc_id: 'doc_123' },
        expect.any(String),
        'test-token'
      );
      expect(result).toHaveProperty('content');
    });

    it('should support pagination parameters', async () => {
      registerFetchDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_fetch_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({
        title: 'Test Document',
        content: '...partial content...',
        has_more: true,
      });

      const result = await tool.handler(
        { doc_id: 'doc_123', offset: 1000, limit: 500 },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(callMcpTool).toHaveBeenCalledWith(
        'fetch-doc',
        { doc_id: 'doc_123', offset: 1000, limit: 500 },
        expect.any(String),
        'test-token'
      );
      expect(result).toHaveProperty('content');
    });

    it('should handle authorization errors', async () => {
      registerFetchDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_fetch_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockImplementation(() => {
        throw new NeedAuthorizationError('Token expired');
      });

      const result = await tool.handler(
        { doc_id: 'doc_123' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('authorization required');
    });
  });
});
