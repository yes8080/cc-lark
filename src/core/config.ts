/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Configuration management for the cc-lark MCP Server.
 *
 * Loads configuration from environment variables and provides validation.
 */

import type { FeishuConfig, ConfigValidationResult, LarkBrand } from './types.js';

// ---------------------------------------------------------------------------
// Environment variable names
// ---------------------------------------------------------------------------

export const ENV_VARS = {
  APP_ID: 'FEISHU_APP_ID',
  APP_SECRET: 'FEISHU_APP_SECRET',
  USER_ACCESS_TOKEN: 'FEISHU_USER_ACCESS_TOKEN',
  BRAND: 'FEISHU_BRAND',
  ENCRYPT_KEY: 'FEISHU_ENCRYPT_KEY',
  VERIFICATION_TOKEN: 'FEISHU_VERIFICATION_TOKEN',
} as const;

// ---------------------------------------------------------------------------
// Configuration loader
// ---------------------------------------------------------------------------

/**
 * Load Feishu configuration from environment variables.
 *
 * Required:
 * - FEISHU_APP_ID: Feishu App ID
 * - FEISHU_APP_SECRET: Feishu App Secret
 *
 * Optional:
 * - FEISHU_USER_ACCESS_TOKEN: User access token for user-authorized operations
 * - FEISHU_BRAND: Platform brand ('feishu' | 'lark' | custom URL)
 * - FEISHU_ENCRYPT_KEY: Encryption key for webhook events
 * - FEISHU_VERIFICATION_TOKEN: Verification token for webhooks
 */
export function loadConfig(): FeishuConfig {
  const appId = process.env[ENV_VARS.APP_ID];
  const appSecret = process.env[ENV_VARS.APP_SECRET];
  const userAccessToken = process.env[ENV_VARS.USER_ACCESS_TOKEN];
  const brand = process.env[ENV_VARS.BRAND] as LarkBrand | undefined;
  const encryptKey = process.env[ENV_VARS.ENCRYPT_KEY];
  const verificationToken = process.env[ENV_VARS.VERIFICATION_TOKEN];

  return {
    appId: appId ?? '',
    appSecret: appSecret ?? '',
    userAccessToken,
    brand: brand ?? 'feishu',
    encryptKey,
    verificationToken,
  };
}

/**
 * Validate the Feishu configuration.
 *
 * @param config - Configuration to validate
 * @returns Validation result with errors if any
 */
export function validateConfig(config: FeishuConfig): ConfigValidationResult {
  const errors: string[] = [];

  if (!config.appId) {
    errors.push(`Missing required environment variable: ${ENV_VARS.APP_ID}`);
  }

  if (!config.appSecret) {
    errors.push(`Missing required environment variable: ${ENV_VARS.APP_SECRET}`);
  }

  if (config.brand) {
    const validBrands: LarkBrand[] = ['feishu', 'lark'];
    if (!validBrands.includes(config.brand) && !config.brand.startsWith('https://')) {
      errors.push(
        `Invalid FEISHU_BRAND value: "${config.brand}". Must be "feishu", "lark", or a custom HTTPS URL`
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], config };
}

/**
 * Load and validate configuration in one step.
 *
 * @throws Error if configuration is invalid
 * @returns Validated Feishu configuration
 */
export function loadAndValidateConfig(): FeishuConfig {
  const config = loadConfig();
  const result = validateConfig(config);

  if (!result.valid) {
    throw new Error(`Invalid configuration:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  return config;
}

/**
 * Check if configuration has user access token.
 *
 * @param config - Configuration to check
 * @returns True if user access token is configured
 */
export function hasUserAccessToken(config: FeishuConfig): boolean {
  return typeof config.userAccessToken === 'string' && config.userAccessToken.length > 0;
}

/**
 * Get the base URL for the Lark API based on brand.
 *
 * @param brand - Platform brand
 * @returns Base URL for API calls
 */
export function getApiBaseUrl(brand: LarkBrand = 'feishu'): string {
  if (brand === 'lark') {
    return 'https://open.larksuite.com/open-apis';
  }
  if (brand.startsWith('https://')) {
    return brand;
  }
  return 'https://open.feishu.cn/open-apis';
}
