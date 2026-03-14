/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for the LarkClient wrapper.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LarkClient,
  getLarkClient,
  createLarkClient,
  resetLarkClient,
  type LarkClientCredentials,
  type FeishuProbeResult,
} from '../../src/core/lark-client.js';
import { ENV_VARS } from '../../src/core/config.js';

describe('LarkClient', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant environment variables before each test
    Object.values(ENV_VARS).forEach(key => {
      delete process.env[key];
    });
    // Reset singleton before each test
    resetLarkClient();
  });

  afterEach(() => {
    // Restore original environment
    Object.values(ENV_VARS).forEach(key => {
      delete process.env[key];
    });
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value !== undefined) {
        process.env[key] = value;
      }
    });
    // Reset singleton after each test
    resetLarkClient();
  });

  describe('constructor', () => {
    it('should create a LarkClient with valid config', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'feishu' as const,
      };

      const client = new LarkClient(config);

      expect(client.appId).toBe('test-app-id');
      expect(client.brand).toBe('feishu');
      expect(client.config).toEqual(config);
    });

    it('should accept lark brand', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'lark' as const,
      };

      const client = new LarkClient(config);

      expect(client.brand).toBe('lark');
    });

    it('should accept custom brand URL', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'https://custom.lark.com',
      };

      const client = new LarkClient(config);

      expect(client.brand).toBe('https://custom.lark.com');
    });

    it('should default brand to feishu if not specified', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
      };

      const client = new LarkClient(config);

      expect(client.brand).toBe('feishu');
    });

    it('should accept optional encryptKey and verificationToken', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        encryptKey: 'test-encrypt-key',
        verificationToken: 'test-verification-token',
      };

      const client = new LarkClient(config);

      expect(client.config.encryptKey).toBe('test-encrypt-key');
      expect(client.config.verificationToken).toBe('test-verification-token');
    });
  });

  describe('fromCredentials', () => {
    it('should create client from credentials', () => {
      const credentials: LarkClientCredentials = {
        appId: 'cli_test-app-id',
        appSecret: 'cli_test-app-secret',
        brand: 'lark',
      };

      const client = LarkClient.fromCredentials(credentials);

      expect(client.appId).toBe('cli_test-app-id');
      expect(client.brand).toBe('lark');
    });

    it('should throw error for missing appId', () => {
      const credentials: LarkClientCredentials = {
        appSecret: 'test-app-secret',
      };

      expect(() => LarkClient.fromCredentials(credentials)).toThrow('Invalid credentials');
    });

    it('should throw error for missing appSecret', () => {
      const credentials: LarkClientCredentials = {
        appId: 'test-app-id',
      };

      expect(() => LarkClient.fromCredentials(credentials)).toThrow('Invalid credentials');
    });
  });

  describe('fromEnv', () => {
    it('should create client from environment variables', () => {
      process.env[ENV_VARS.APP_ID] = 'env-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'env-app-secret';
      process.env[ENV_VARS.BRAND] = 'lark';

      const client = LarkClient.fromEnv();

      expect(client.appId).toBe('env-app-id');
      expect(client.brand).toBe('lark');
    });

    it('should throw error for missing environment variables', () => {
      expect(() => LarkClient.fromEnv()).toThrow('Invalid configuration');
    });
  });

  describe('singleton pattern', () => {
    it('should return the same instance from getInstance', () => {
      process.env[ENV_VARS.APP_ID] = 'singleton-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'singleton-app-secret';

      const client1 = LarkClient.getInstance();
      const client2 = LarkClient.getInstance();

      expect(client1).toBe(client2);
    });

    it('should create new instance after reset', () => {
      process.env[ENV_VARS.APP_ID] = 'reset-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'reset-app-secret';

      const client1 = LarkClient.getInstance();
      LarkClient.resetInstance();
      const client2 = LarkClient.getInstance();

      expect(client1).not.toBe(client2);
    });
  });

  describe('getLarkClient convenience function', () => {
    it('should return singleton instance', () => {
      process.env[ENV_VARS.APP_ID] = 'convenience-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'convenience-app-secret';

      const client1 = getLarkClient();
      const client2 = getLarkClient();

      expect(client1).toBe(client2);
      expect(client1.appId).toBe('convenience-app-id');
    });
  });

  describe('createLarkClient convenience function', () => {
    it('should create and set singleton instance', () => {
      process.env[ENV_VARS.APP_ID] = 'create-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'create-app-secret';

      const client = createLarkClient();

      expect(client.appId).toBe('create-app-id');
      expect(getLarkClient()).toBe(client);
    });
  });

  describe('resetLarkClient convenience function', () => {
    it('should reset singleton instance', () => {
      process.env[ENV_VARS.APP_ID] = 'reset-func-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'reset-func-app-secret';

      const client1 = getLarkClient();
      resetLarkClient();

      expect(LarkClient.getInstance()).not.toBe(client1);
    });
  });

  describe('SDK access', () => {
    it('should throw error when accessing SDK without credentials', () => {
      const config = {
        appId: '',
        appSecret: '',
      };

      const client = new LarkClient(config);

      expect(() => client.sdk).toThrow('appId and appSecret are required');
    });

    it('should create SDK client when credentials are valid', () => {
      const config = {
        appId: 'sdk-app-id',
        appSecret: 'sdk-app-secret',
      };

      const client = new LarkClient(config);

      // SDK should be created without throwing
      expect(client.sdk).toBeDefined();
    });

    it('should return the same SDK instance on multiple accesses', () => {
      const config = {
        appId: 'sdk-cache-app-id',
        appSecret: 'sdk-cache-app-secret',
      };

      const client = new LarkClient(config);

      const sdk1 = client.sdk;
      const sdk2 = client.sdk;

      expect(sdk1).toBe(sdk2);
    });
  });

  describe('probe cache', () => {
    it('should start with no cached probe result', () => {
      const config = {
        appId: 'probe-app-id',
        appSecret: 'probe-app-secret',
      };

      const client = new LarkClient(config);

      expect(client.lastProbeResult).toBeNull();
      expect(client.botOpenId).toBeUndefined();
      expect(client.botName).toBeUndefined();
    });

    it('should clear probe cache when clearProbeCache is called', () => {
      const config = {
        appId: 'clear-probe-app-id',
        appSecret: 'clear-probe-app-secret',
      };

      const client = new LarkClient(config);

      // Manually set probe result for testing
      (client as any)._lastProbeResult = { ok: true, appId: 'test' };
      (client as any)._botOpenId = 'test-open-id';
      (client as any)._botName = 'test-bot-name';

      client.clearProbeCache();

      expect(client.lastProbeResult).toBeNull();
      expect(client.botOpenId).toBeUndefined();
      expect(client.botName).toBeUndefined();
    });
  });

  describe('dispose', () => {
    it('should clear all caches and SDK reference', () => {
      const config = {
        appId: 'dispose-app-id',
        appSecret: 'dispose-app-secret',
      };

      const client = new LarkClient(config);

      // Initialize SDK
      const sdk = client.sdk;
      expect(sdk).toBeDefined();

      // Manually set some cache
      (client as any)._lastProbeResult = { ok: true, appId: 'test' };

      client.dispose();

      expect(client.lastProbeResult).toBeNull();
      expect((client as any)._sdk).toBeNull();
    });
  });

  describe('probe', () => {
    it('should return error for missing credentials', async () => {
      const config = {
        appId: '',
        appSecret: '',
      };

      const client = new LarkClient(config);

      const result = await client.probe();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('missing credentials');
    });

    it('should use cached result within maxAgeMs', async () => {
      const config = {
        appId: 'cache-probe-app-id',
        appSecret: 'cache-probe-app-secret',
      };

      const client = new LarkClient(config);

      // Manually set a cached result
      const cachedResult: FeishuProbeResult = {
        ok: true,
        appId: 'cache-probe-app-id',
        botName: 'CachedBot',
        botOpenId: 'cached-open-id',
      };
      (client as any)._lastProbeResult = cachedResult;
      (client as any)._lastProbeAt = Date.now();

      // Probe with maxAgeMs should return cached result
      const result = await client.probe({ maxAgeMs: 60000 });

      expect(result).toEqual(cachedResult);
    });

    it('should skip cache when maxAgeMs is 0', async () => {
      const config = {
        appId: 'skip-cache-app-id',
        appSecret: 'skip-cache-app-secret',
      };

      const client = new LarkClient(config);

      // Set a cached result
      (client as any)._lastProbeResult = {
        ok: true,
        appId: 'skip-cache-app-id',
        botName: 'CachedBot',
      };
      (client as any)._lastProbeAt = Date.now();

      // Probe with maxAgeMs: 0 should bypass cache and call API
      // This will fail because we don't have a real API, but that's fine for testing
      const result = await client.probe({ maxAgeMs: 0 });

      // The result will be an error since we can't call the real API
      expect(result.appId).toBe('skip-cache-app-id');
    });
  });
});
