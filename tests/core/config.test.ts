/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for the configuration module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  validateConfig,
  loadAndValidateConfig,
  hasUserAccessToken,
  getApiBaseUrl,
  ENV_VARS,
} from '../../src/core/config.js';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant environment variables before each test
    Object.values(ENV_VARS).forEach(key => {
      delete process.env[key];
    });
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
  });

  describe('loadConfig', () => {
    it('should load configuration from environment variables', () => {
      process.env[ENV_VARS.APP_ID] = 'test-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'test-app-secret';
      process.env[ENV_VARS.USER_ACCESS_TOKEN] = 'test-user-token';
      process.env[ENV_VARS.BRAND] = 'lark';

      const config = loadConfig();

      expect(config.appId).toBe('test-app-id');
      expect(config.appSecret).toBe('test-app-secret');
      expect(config.userAccessToken).toBe('test-user-token');
      expect(config.brand).toBe('lark');
    });

    it('should return empty strings for missing required values', () => {
      const config = loadConfig();

      expect(config.appId).toBe('');
      expect(config.appSecret).toBe('');
      expect(config.userAccessToken).toBeUndefined();
    });

    it('should default brand to feishu if not specified', () => {
      process.env[ENV_VARS.APP_ID] = 'test-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'test-app-secret';

      const config = loadConfig();

      expect(config.brand).toBe('feishu');
    });

    it('should load optional encrypt key and verification token', () => {
      process.env[ENV_VARS.APP_ID] = 'test-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'test-app-secret';
      process.env[ENV_VARS.ENCRYPT_KEY] = 'test-encrypt-key';
      process.env[ENV_VARS.VERIFICATION_TOKEN] = 'test-verification-token';

      const config = loadConfig();

      expect(config.encryptKey).toBe('test-encrypt-key');
      expect(config.verificationToken).toBe('test-verification-token');
    });
  });

  describe('validateConfig', () => {
    it('should pass validation with valid config', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'feishu' as const,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.config).toEqual(config);
    });

    it('should fail validation when appId is missing', () => {
      const config = {
        appId: '',
        appSecret: 'test-app-secret',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(`Missing required environment variable: ${ENV_VARS.APP_ID}`);
    });

    it('should fail validation when appSecret is missing', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: '',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(`Missing required environment variable: ${ENV_VARS.APP_SECRET}`);
    });

    it('should fail validation for invalid brand value', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'invalid-brand' as const,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid FEISHU_BRAND value');
    });

    it('should accept custom HTTPS URL as brand', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'https://custom.lark.com' as const,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
    });

    it('should accept "lark" as brand', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'lark' as const,
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
    });

    it('should report multiple validation errors', () => {
      const config = {
        appId: '',
        appSecret: '',
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('loadAndValidateConfig', () => {
    it('should load and return valid config', () => {
      process.env[ENV_VARS.APP_ID] = 'test-app-id';
      process.env[ENV_VARS.APP_SECRET] = 'test-app-secret';

      const config = loadAndValidateConfig();

      expect(config.appId).toBe('test-app-id');
      expect(config.appSecret).toBe('test-app-secret');
    });

    it('should throw error for invalid config', () => {
      expect(() => loadAndValidateConfig()).toThrow('Invalid configuration');
    });
  });

  describe('hasUserAccessToken', () => {
    it('should return true when user access token is set', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        userAccessToken: 'test-token',
      };

      expect(hasUserAccessToken(config)).toBe(true);
    });

    it('should return false when user access token is not set', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
      };

      expect(hasUserAccessToken(config)).toBe(false);
    });

    it('should return false when user access token is empty string', () => {
      const config = {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        userAccessToken: '',
      };

      expect(hasUserAccessToken(config)).toBe(false);
    });
  });

  describe('getApiBaseUrl', () => {
    it('should return Feishu URL for feishu brand', () => {
      expect(getApiBaseUrl('feishu')).toBe('https://open.feishu.cn/open-apis');
    });

    it('should return Lark URL for lark brand', () => {
      expect(getApiBaseUrl('lark')).toBe('https://open.larksuite.com/open-apis');
    });

    it('should return custom URL for custom brand', () => {
      expect(getApiBaseUrl('https://custom.api.com')).toBe('https://custom.api.com');
    });

    it('should default to feishu when no brand specified', () => {
      expect(getApiBaseUrl()).toBe('https://open.feishu.cn/open-apis');
    });
  });
});
