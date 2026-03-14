/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for feishu_create_doc tool.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
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
import { registerCreateDocTool } from '../../../src/tools/doc/create.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../../src/core/uat-client.js';
import { listStoredTokens } from '../../../src/core/token-store.js';
import { callMcpTool } from '../../../src/tools/doc/shared.js';

describe('doc/create', () => {
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

  describe('registerCreateDocTool', () => {
    it('should register the tool with correct name', () => {
      registerCreateDocTool(mockRegistry);
      expect(registeredTools.has('feishu_create_doc')).toBe(true);
    });

    it('should have a description', () => {
      registerCreateDocTool(mockRegistry);
      const registration = vi.mocked(mockRegistry.register).mock.calls[0][0];
      expect(registration.description).toContain('Create a new Feishu docx document');
    });
  });

  describe('validation', () => {
    it('should fail when markdown is missing without task_id', async () => {
      registerCreateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_create_doc');
      if (!tool) throw new Error('Tool not registered');

      const result = await tool.handler(
        { title: 'Test Doc' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('markdown and title are required');
    });

    it('should fail when title is missing without task_id', async () => {
      registerCreateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_create_doc');
      if (!tool) throw new Error('Tool not registered');

      const result = await tool.handler(
        { markdown: '# Hello' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('markdown and title are required');
    });

    it('should fail when multiple location parameters are provided', async () => {
      registerCreateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_create_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({ task_id: 'task_123' });

      const result = await tool.handler(
        { markdown: '# Hello', title: 'Test', folder_token: 'folder_123', wiki_node: 'wiki_123' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('mutually exclusive');
    });
  });

  describe('handler', () => {
    it('should fail when LarkClient is null', async () => {
      registerCreateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_create_doc');
      if (!tool) throw new Error('Tool not registered');

      const result = await tool.handler(
        { markdown: '# Test', title: 'Test Doc' },
        { larkClient: null, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('LarkClient not initialized');
    });

    it('should fail when no user authorization', async () => {
      registerCreateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_create_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([]);

      const result = await tool.handler(
        { markdown: '# Test', title: 'Test Doc' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('No user authorization');
    });

    it('should call MCP tool with correct parameters', async () => {
      registerCreateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_create_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({ task_id: 'task_123', doc_id: 'doc_abc' });

      const result = await tool.handler(
        { markdown: '# Test', title: 'Test Doc' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(callMcpTool).toHaveBeenCalledWith(
        'create-doc',
        { markdown: '# Test', title: 'Test Doc' },
        expect.any(String),
        'test-token'
      );
      expect(result).toHaveProperty('content');
    });

    it('should handle task_id query mode', async () => {
      registerCreateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_create_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({ status: 'completed', result: { doc_id: 'doc_abc' } });

      const result = await tool.handler(
        { task_id: 'task_123' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(callMcpTool).toHaveBeenCalledWith(
        'create-doc',
        { task_id: 'task_123' },
        expect.any(String),
        'test-token'
      );
      expect(result).toHaveProperty('content');
    });

    it('should handle authorization errors', async () => {
      registerCreateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_create_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockImplementation(() => {
        throw new NeedAuthorizationError('Token expired');
      });

      const result = await tool.handler(
        { markdown: '# Test', title: 'Test Doc' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('authorization required');
    });
  });
});
