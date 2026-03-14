/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for the shared authentication helper module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getToolAccessToken,
  isToolResult,
  withUserAccessToken,
  type AuthContext,
} from '../../../src/tools/common/auth-helper.js';
import type { ToolResult } from '../../../src/tools/common/helpers.js';

// Mock dependencies
vi.mock('../../../src/core/uat-client.js', () => ({
  getValidAccessToken: vi.fn(),
  NeedAuthorizationError: class NeedAuthorizationError extends Error {
    constructor(message?: string) {
      super(message ?? 'Need authorization');
      this.name = 'NeedAuthorizationError';
    }
  },
}));

vi.mock('../../../src/core/token-store.js', () => ({
  listStoredTokens: vi.fn(),
}));

describe('common/auth-helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isToolResult', () => {
    it('should return true for ToolResult objects', () => {
      const toolResult: ToolResult = {
        content: [{ type: 'text', text: 'error' }],
        isError: true,
      };

      expect(isToolResult(toolResult)).toBe(true);
    });

    it('should return false for string values', () => {
      expect(isToolResult('access-token-string')).toBe(false);
    });

    it('should return true for ToolResult without isError', () => {
      const toolResult: ToolResult = {
        content: [{ type: 'text', text: 'data' }],
      };

      expect(isToolResult(toolResult)).toBe(true);
    });
  });

  describe('getToolAccessToken', () => {
    it('should return error when larkClient is null', async () => {
      const context: AuthContext = {
        larkClient: null,
        config: { appId: 'test-id', appSecret: 'test-secret' },
      };

      const result = await getToolAccessToken(context);

      expect(isToolResult(result)).toBe(true);
      const parsed = JSON.parse((result as ToolResult).content[0].text);
      expect(parsed.error).toContain('LarkClient not initialized');
    });

    it('should return error when appId is missing', async () => {
      const mockClient = { sdk: {} };
      const context: AuthContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        larkClient: mockClient as any,
        config: { appId: '', appSecret: 'test-secret' },
      };

      const result = await getToolAccessToken(context);

      expect(isToolResult(result)).toBe(true);
      const parsed = JSON.parse((result as ToolResult).content[0].text);
      expect(parsed.error).toContain('Missing FEISHU_APP_ID');
    });

    it('should return error when appSecret is missing', async () => {
      const mockClient = { sdk: {} };
      const context: AuthContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        larkClient: mockClient as any,
        config: { appId: 'test-id', appSecret: '' },
      };

      const result = await getToolAccessToken(context);

      expect(isToolResult(result)).toBe(true);
      const parsed = JSON.parse((result as ToolResult).content[0].text);
      expect(parsed.error).toContain('Missing FEISHU_APP_ID');
    });

    it('should return error when no tokens are stored', async () => {
      const { listStoredTokens } = await import('../../../src/core/token-store.js');
      vi.mocked(listStoredTokens).mockResolvedValue([]);

      const mockClient = { sdk: {} };
      const context: AuthContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        larkClient: mockClient as any,
        config: { appId: 'test-id', appSecret: 'test-secret' },
      };

      const result = await getToolAccessToken(context);

      expect(isToolResult(result)).toBe(true);
      const parsed = JSON.parse((result as ToolResult).content[0].text);
      expect(parsed.error).toContain('No user authorization found');
    });

    it('should return access token on success', async () => {
      const { listStoredTokens } = await import('../../../src/core/token-store.js');
      vi.mocked(listStoredTokens).mockResolvedValue([
        { userOpenId: 'ou_test', appId: 'test-id' },
      ] as ReturnType<typeof listStoredTokens> extends Promise<infer T> ? T : never);

      const { getValidAccessToken } = await import('../../../src/core/uat-client.js');
      vi.mocked(getValidAccessToken).mockResolvedValue('valid-access-token');

      const mockClient = { sdk: {} };
      const context: AuthContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        larkClient: mockClient as any,
        config: { appId: 'test-id', appSecret: 'test-secret', brand: 'feishu' },
      };

      const result = await getToolAccessToken(context);

      expect(isToolResult(result)).toBe(false);
      expect(result).toBe('valid-access-token');
      expect(getValidAccessToken).toHaveBeenCalledWith({
        userOpenId: 'ou_test',
        appId: 'test-id',
        appSecret: 'test-secret',
        domain: 'feishu',
      });
    });

    it('should default domain to feishu when brand is undefined', async () => {
      const { listStoredTokens } = await import('../../../src/core/token-store.js');
      vi.mocked(listStoredTokens).mockResolvedValue([
        { userOpenId: 'ou_test', appId: 'test-id' },
      ] as ReturnType<typeof listStoredTokens> extends Promise<infer T> ? T : never);

      const { getValidAccessToken } = await import('../../../src/core/uat-client.js');
      vi.mocked(getValidAccessToken).mockResolvedValue('token');

      const mockClient = { sdk: {} };
      const context: AuthContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        larkClient: mockClient as any,
        config: { appId: 'test-id', appSecret: 'test-secret' },
      };

      await getToolAccessToken(context);

      expect(getValidAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ domain: 'feishu' })
      );
    });

    it('should return error when NeedAuthorizationError is thrown', async () => {
      const { listStoredTokens } = await import('../../../src/core/token-store.js');
      vi.mocked(listStoredTokens).mockResolvedValue([
        { userOpenId: 'ou_test', appId: 'test-id' },
      ] as ReturnType<typeof listStoredTokens> extends Promise<infer T> ? T : never);

      const { getValidAccessToken, NeedAuthorizationError } = await import(
        '../../../src/core/uat-client.js'
      );
      vi.mocked(getValidAccessToken).mockRejectedValue(new NeedAuthorizationError());

      const mockClient = { sdk: {} };
      const context: AuthContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        larkClient: mockClient as any,
        config: { appId: 'test-id', appSecret: 'test-secret' },
      };

      const result = await getToolAccessToken(context);

      expect(isToolResult(result)).toBe(true);
      const parsed = JSON.parse((result as ToolResult).content[0].text);
      expect(parsed.error).toContain('authorization');
    });

    it('should re-throw non-NeedAuthorizationError exceptions', async () => {
      const { listStoredTokens } = await import('../../../src/core/token-store.js');
      vi.mocked(listStoredTokens).mockResolvedValue([
        { userOpenId: 'ou_test', appId: 'test-id' },
      ] as ReturnType<typeof listStoredTokens> extends Promise<infer T> ? T : never);

      const { getValidAccessToken } = await import('../../../src/core/uat-client.js');
      vi.mocked(getValidAccessToken).mockRejectedValue(new Error('Network failure'));

      const mockClient = { sdk: {} };
      const context: AuthContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        larkClient: mockClient as any,
        config: { appId: 'test-id', appSecret: 'test-secret' },
      };

      await expect(getToolAccessToken(context)).rejects.toThrow('Network failure');
    });
  });

  describe('withUserAccessToken', () => {
    it('should return Lark SDK options with user access token', async () => {
      const result = await withUserAccessToken('test-token');

      // The result should be a Lark SDK options object
      expect(result).toBeDefined();
    });
  });
});
