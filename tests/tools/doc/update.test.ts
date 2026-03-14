/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for feishu_update_doc tool.
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
import { registerUpdateDocTool } from '../../../src/tools/doc/update.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../../src/core/uat-client.js';
import { listStoredTokens } from '../../../src/core/token-store.js';
import { callMcpTool } from '../../../src/tools/doc/shared.js';

describe('doc/update', () => {
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

  describe('registerUpdateDocTool', () => {
    it('should register the tool with correct name', () => {
      registerUpdateDocTool(mockRegistry);
      expect(registeredTools.has('feishu_update_doc')).toBe(true);
    });

    it('should have a description', () => {
      registerUpdateDocTool(mockRegistry);
      const registration = vi.mocked(mockRegistry.register).mock.calls[0][0];
      expect(registration.description).toContain('Update a Feishu document');
    });
  });

  describe('validation', () => {
    it('should fail when doc_id is missing without task_id', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      const result = await tool.handler(
        { mode: 'overwrite', markdown: '# New content' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('doc_id is required');
    });

    it('should fail when mode is missing without task_id', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      const result = await tool.handler(
        { doc_id: 'doc_123', markdown: '# New content' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('mode is required');
    });

    it('should fail when markdown is missing for non-delete modes', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      const result = await tool.handler(
        { doc_id: 'doc_123', mode: 'overwrite' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('markdown is required');
    });

    it('should fail when selection parameters are missing for range modes', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');

      const result = await tool.handler(
        { doc_id: 'doc_123', mode: 'replace_range', markdown: 'new text' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('exactly one of selection_with_ellipsis or selection_by_title');
    });

    it('should fail when both selection parameters are provided', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');

      const result = await tool.handler(
        {
          doc_id: 'doc_123',
          mode: 'replace_range',
          markdown: 'new text',
          selection_with_ellipsis: 'start...end',
          selection_by_title: '## Title',
        },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('exactly one of selection_with_ellipsis or selection_by_title');
    });

    it('should not require markdown for delete_range mode', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({ task_id: 'task_123' });

      const result = await tool.handler(
        {
          doc_id: 'doc_123',
          mode: 'delete_range',
          selection_by_title: '## Section to Delete',
        },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(callMcpTool).toHaveBeenCalledWith(
        'update-doc',
        {
          doc_id: 'doc_123',
          mode: 'delete_range',
          selection_by_title: '## Section to Delete',
        },
        expect.any(String),
        'test-token'
      );
      expect(result).toHaveProperty('content');
    });
  });

  describe('handler', () => {
    it('should fail when LarkClient is null', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      const result = await tool.handler(
        { doc_id: 'doc_123', mode: 'overwrite', markdown: '# Test' },
        { larkClient: null, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('LarkClient not initialized');
    });

    it('should call MCP tool with overwrite mode', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({ task_id: 'task_123' });

      const result = await tool.handler(
        { doc_id: 'doc_123', mode: 'overwrite', markdown: '# New Content' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(callMcpTool).toHaveBeenCalledWith(
        'update-doc',
        { doc_id: 'doc_123', mode: 'overwrite', markdown: '# New Content' },
        expect.any(String),
        'test-token'
      );
      expect(result).toHaveProperty('content');
    });

    it('should call MCP tool with append mode', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({ task_id: 'task_123' });

      const result = await tool.handler(
        { doc_id: 'doc_123', mode: 'append', markdown: '\n\n## New Section\n\nAdded content.' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(callMcpTool).toHaveBeenCalledWith(
        'update-doc',
        { doc_id: 'doc_123', mode: 'append', markdown: '\n\n## New Section\n\nAdded content.' },
        expect.any(String),
        'test-token'
      );
      expect(result).toHaveProperty('content');
    });

    it('should call MCP tool with replace_range mode using selection_by_title', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({ task_id: 'task_123' });

      const result = await tool.handler(
        {
          doc_id: 'doc_123',
          mode: 'replace_range',
          markdown: '## Updated Section\n\nNew content here.',
          selection_by_title: '## Old Section',
        },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(callMcpTool).toHaveBeenCalledWith(
        'update-doc',
        {
          doc_id: 'doc_123',
          mode: 'replace_range',
          markdown: '## Updated Section\n\nNew content here.',
          selection_by_title: '## Old Section',
        },
        expect.any(String),
        'test-token'
      );
      expect(result).toHaveProperty('content');
    });

    it('should call MCP tool with task_id for status check', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
      vi.mocked(callMcpTool).mockResolvedValue({ status: 'completed', result: { success: true } });

      const result = await tool.handler(
        { task_id: 'task_123' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(callMcpTool).toHaveBeenCalledWith(
        'update-doc',
        { task_id: 'task_123' },
        expect.any(String),
        'test-token'
      );
      expect(result).toHaveProperty('content');
    });

    it('should handle authorization errors', async () => {
      registerUpdateDocTool(mockRegistry);
      const tool = registeredTools.get('feishu_update_doc');
      if (!tool) throw new Error('Tool not registered');

      vi.mocked(listStoredTokens).mockResolvedValue([{ userOpenId: 'ou_test', accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }]);
      vi.mocked(getValidAccessToken).mockImplementation(() => {
        throw new NeedAuthorizationError('Token expired');
      });

      const result = await tool.handler(
        { doc_id: 'doc_123', mode: 'overwrite', markdown: '# Test' },
        { larkClient: {}, config: { appId: 'test', appSecret: 'test' } }
      );

      expect(result).toHaveProperty('isError', true);
      expect(JSON.stringify(result)).toContain('authorization required');
    });
  });
});
