/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for device-flow.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveOAuthEndpoints,
  requestDeviceAuthorization,
  pollDeviceToken,
} from '../../src/core/device-flow.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock version
vi.mock('../../src/core/version.js', () => ({
  getUserAgent: () => 'cc-lark/0.1.0-test',
}));

describe('resolveOAuthEndpoints', () => {
  it('should return Feishu endpoints for feishu brand', () => {
    const endpoints = resolveOAuthEndpoints('feishu');
    expect(endpoints.deviceAuthorization).toBe('https://accounts.feishu.cn/oauth/v1/device_authorization');
    expect(endpoints.token).toBe('https://open.feishu.cn/open-apis/authen/v2/oauth/token');
  });

  it('should return Lark endpoints for lark brand', () => {
    const endpoints = resolveOAuthEndpoints('lark');
    expect(endpoints.deviceAuthorization).toBe('https://accounts.larksuite.com/oauth/v1/device_authorization');
    expect(endpoints.token).toBe('https://open.larksuite.com/open-apis/authen/v2/oauth/token');
  });

  it('should return Feishu endpoints for empty brand', () => {
    const endpoints = resolveOAuthEndpoints('');
    expect(endpoints.deviceAuthorization).toBe('https://accounts.feishu.cn/oauth/v1/device_authorization');
    expect(endpoints.token).toBe('https://open.feishu.cn/open-apis/authen/v2/oauth/token');
  });

  it('should derive endpoints for custom domain', () => {
    const endpoints = resolveOAuthEndpoints('https://open.custom.com');
    expect(endpoints.deviceAuthorization).toBe('https://accounts.custom.com/oauth/v1/device_authorization');
    expect(endpoints.token).toBe('https://open.custom.com/open-apis/authen/v2/oauth/token');
  });

  it('should handle custom domain without open prefix', () => {
    const endpoints = resolveOAuthEndpoints('https://api.custom.com');
    expect(endpoints.deviceAuthorization).toBe('https://api.custom.com/oauth/v1/device_authorization');
    expect(endpoints.token).toBe('https://api.custom.com/open-apis/authen/v2/oauth/token');
  });

  it('should strip trailing slashes from custom domain', () => {
    const endpoints = resolveOAuthEndpoints('https://open.custom.com/');
    expect(endpoints.token).toBe('https://open.custom.com/open-apis/authen/v2/oauth/token');
  });
});

describe('requestDeviceAuthorization', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should request device authorization successfully', async () => {
    const mockResponse = {
      device_code: 'test-device-code',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://accounts.feishu.cn/oauth/device',
      verification_uri_complete: 'https://accounts.feishu.cn/oauth/device?code=ABCD-EFGH',
      expires_in: 300,
      interval: 5,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    const result = await requestDeviceAuthorization({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      scope: 'contact:user.base:readonly',
    });

    expect(result.deviceCode).toBe('test-device-code');
    expect(result.userCode).toBe('ABCD-EFGH');
    expect(result.verificationUri).toBe('https://accounts.feishu.cn/oauth/device');
    expect(result.expiresIn).toBe(300);
    expect(result.interval).toBe(5);

    // Verify fetch was called with correct parameters
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://accounts.feishu.cn/oauth/v1/device_authorization');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.headers['Authorization']).toMatch(/^Basic /);
    expect(init.body).toContain('client_id=test-app-id');
    // Should automatically add offline_access
    expect(init.body).toContain('scope=contact%3Auser.base%3Areadonly+offline_access');
  });

  it('should automatically add offline_access scope if not present', async () => {
    const mockResponse = {
      device_code: 'test-device-code',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://accounts.feishu.cn/oauth/device',
      expires_in: 300,
      interval: 5,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    await requestDeviceAuthorization({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      // No scope provided
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toContain('scope=offline_access');
  });

  it('should not duplicate offline_access if already present', async () => {
    const mockResponse = {
      device_code: 'test-device-code',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://accounts.feishu.cn/oauth/device',
      expires_in: 300,
      interval: 5,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    await requestDeviceAuthorization({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      scope: 'contact:user.base:readonly offline_access',
    });

    const [, init] = mockFetch.mock.calls[0];
    // Should not duplicate offline_access
    const offlineAccessCount = (init.body.match(/offline_access/g) || []).length;
    expect(offlineAccessCount).toBe(1);
  });

  it('should throw on authorization failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'invalid_client', error_description: 'Invalid client' }),
    });

    await expect(
      requestDeviceAuthorization({
        appId: 'invalid-app',
        appSecret: 'invalid-secret',
        brand: 'feishu',
      })
    ).rejects.toThrow('Device authorization failed: Invalid client');
  });

  it('should throw on non-JSON response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(
      requestDeviceAuthorization({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'feishu',
      })
    ).rejects.toThrow('Device authorization failed: HTTP 500');
  });

  it('should use default values for missing fields', async () => {
    const mockResponse = {
      device_code: 'test-device-code',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://accounts.feishu.cn/oauth/device',
      // No expires_in or interval
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    const result = await requestDeviceAuthorization({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
    });

    expect(result.expiresIn).toBe(240); // Default
    expect(result.interval).toBe(5); // Default
  });
});

describe('pollDeviceToken', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should poll and return token on success', async () => {
    // First poll returns authorization_pending
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'authorization_pending' }),
    });

    // Second poll returns success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 7200,
        refresh_token_expires_in: 604800,
        scope: 'contact:user.base:readonly offline_access',
      }),
    });

    const promise = pollDeviceToken({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      deviceCode: 'test-device-code',
      interval: 1,
      expiresIn: 10,
    });

    // Advance past the first sleep
    await vi.advanceTimersByTimeAsync(1000);
    // Advance past the second sleep
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token.accessToken).toBe('test-access-token');
      expect(result.token.refreshToken).toBe('test-refresh-token');
      expect(result.token.expiresIn).toBe(7200);
      expect(result.token.refreshExpiresIn).toBe(604800);
    }
  });

  it('should handle slow_down error', async () => {
    // First poll returns slow_down
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'slow_down' }),
    });

    // Second poll returns success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 7200,
        refresh_token_expires_in: 604800,
        scope: 'contact:user.base:readonly offline_access',
      }),
    });

    const promise = pollDeviceToken({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      deviceCode: 'test-device-code',
      interval: 1,
      expiresIn: 30,
    });

    // Advance past first sleep (interval increased to 6 after slow_down)
    await vi.advanceTimersByTimeAsync(1000);
    // Advance past second sleep (6 seconds due to slow_down)
    await vi.advanceTimersByTimeAsync(6000);

    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('should handle access_denied error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'access_denied' }),
    });

    const promise = pollDeviceToken({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      deviceCode: 'test-device-code',
      interval: 1,
      expiresIn: 10,
    });

    // Advance past the first sleep
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('access_denied');
      expect(result.message).toBe('User denied authorization');
    }
  });

  it('should handle expired_token error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'expired_token' }),
    });

    const promise = pollDeviceToken({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      deviceCode: 'test-device-code',
      interval: 1,
      expiresIn: 10,
    });

    // Advance past the first sleep
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('expired_token');
    }
  });

  it('should handle invalid_grant as expired_token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'invalid_grant' }),
    });

    const promise = pollDeviceToken({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      deviceCode: 'test-device-code',
      interval: 1,
      expiresIn: 10,
    });

    // Advance past the first sleep
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('expired_token');
    }
  });

  it('should handle abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await pollDeviceToken({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      deviceCode: 'test-device-code',
      interval: 1,
      expiresIn: 10,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('expired_token');
      expect(result.message).toBe('Polling was cancelled');
    }
  });

  it('should handle network errors gracefully', async () => {
    // First call throws network error
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Second call succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 7200,
        refresh_token_expires_in: 604800,
        scope: 'contact:user.base:readonly offline_access',
      }),
    });

    const promise = pollDeviceToken({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      deviceCode: 'test-device-code',
      interval: 1,
      expiresIn: 10,
    });

    // Advance past first sleep
    await vi.advanceTimersByTimeAsync(1000);
    // Advance past second sleep (interval increases to 2 after error)
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('should handle response without refresh_token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'test-access-token',
        // No refresh_token
        expires_in: 7200,
        scope: 'contact:user.base:readonly offline_access',
      }),
    });

    const promise = pollDeviceToken({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
      deviceCode: 'test-device-code',
      interval: 1,
      expiresIn: 10,
    });

    // Advance past the first sleep
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token.refreshToken).toBe('');
      // Should use access token expiry for refresh when no refresh token
      expect(result.token.refreshExpiresIn).toBe(result.token.expiresIn);
    }
  });
});
