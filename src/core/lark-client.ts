/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu / Lark SDK client management for MCP Server.
 *
 * Provides `LarkClient` — a unified manager for Lark SDK client instances,
 * bot identity probing, and token management.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 * - Removed OpenClaw runtime dependencies
 * - Simplified singleton pattern for MCP Server use case
 * - Works standalone with environment variables
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig, LarkBrand } from './types.js';
import { loadAndValidateConfig, validateConfig } from './config.js';
import { logger } from '../utils/logger.js';

const log = logger('lark-client');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of probing an app's connectivity / permissions. */
export interface FeishuProbeResult {
  ok: boolean;
  error?: string;
  appId?: string;
  botName?: string;
  botOpenId?: string;
}

/** Credentials for creating a LarkClient. */
export interface LarkClientCredentials {
  appId?: string;
  appSecret?: string;
  brand?: LarkBrand;
  encryptKey?: string;
  verificationToken?: string;
}

// ---------------------------------------------------------------------------
// Brand → SDK domain
// ---------------------------------------------------------------------------

const BRAND_TO_DOMAIN: Record<string, Lark.Domain> = {
  feishu: Lark.Domain.Feishu,
  lark: Lark.Domain.Lark,
};

/** Map a `LarkBrand` to the SDK `domain` parameter. */
function resolveBrand(brand: LarkBrand | undefined): Lark.Domain | string {
  return BRAND_TO_DOMAIN[brand ?? 'feishu'] ?? brand!.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// User-Agent setup
// ---------------------------------------------------------------------------

const GLOBAL_LARK_USER_AGENT_KEY = 'LARK_USER_AGENT';
const USER_AGENT = 'cc-lark/0.1.0';

function installGlobalUserAgent(): void {
  // node-sdk built-in interceptor reads global.LARK_USER_AGENT and sets User-Agent
  (globalThis as Record<string, unknown>)[GLOBAL_LARK_USER_AGENT_KEY] = USER_AGENT;
}

// Install User-Agent on module load
installGlobalUserAgent();

// Set up HTTP interceptor to add User-Agent header
Lark.defaultHttpInstance.interceptors.request.handlers = [];
Lark.defaultHttpInstance.interceptors.request.use(
  (req) => {
    if (req.headers) {
      req.headers['User-Agent'] = USER_AGENT;
    }
    return req;
  },
  undefined,
  { synchronous: true }
);

// ---------------------------------------------------------------------------
// LarkClient
// ---------------------------------------------------------------------------

/**
 * Lark SDK client wrapper for MCP Server.
 *
 * Provides:
 * - Lazy SDK client initialization
 * - Bot identity probing and caching
 * - Singleton pattern for global access
 */
export class LarkClient {
  private readonly _config: FeishuConfig;
  private _sdk: Lark.Client | null = null;
  private _botOpenId: string | undefined;
  private _botName: string | undefined;
  private _lastProbeResult: FeishuProbeResult | null = null;
  private _lastProbeAt = 0;

  // ---- Singleton instance ---------------------------------------------------

  private static _instance: LarkClient | null = null;

  /**
   * Get the singleton LarkClient instance.
   * Creates one from environment variables if not already created.
   */
  static getInstance(): LarkClient {
    if (!LarkClient._instance) {
      const config = loadAndValidateConfig();
      LarkClient._instance = new LarkClient(config);
    }
    return LarkClient._instance;
  }

  /**
   * Create a new LarkClient from environment variables.
   * This will replace the singleton instance.
   */
  static fromEnv(): LarkClient {
    const config = loadAndValidateConfig();
    const instance = new LarkClient(config);
    LarkClient._instance = instance;
    return instance;
  }

  /**
   * Create a LarkClient from explicit credentials.
   * This replaces the singleton instance.
   */
  static fromCredentials(credentials: LarkClientCredentials): LarkClient {
    const config: FeishuConfig = {
      appId: credentials.appId ?? '',
      appSecret: credentials.appSecret ?? '',
      brand: credentials.brand ?? 'feishu',
      encryptKey: credentials.encryptKey,
      verificationToken: credentials.verificationToken,
    };

    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid credentials: ${validation.errors.join(', ')}`);
    }

    const instance = new LarkClient(config);
    LarkClient._instance = instance;
    return instance;
  }

  /**
   * Reset the singleton instance.
   * Useful for testing or when credentials change.
   */
  static resetInstance(): void {
    if (LarkClient._instance) {
      LarkClient._instance.dispose();
      LarkClient._instance = null;
    }
  }

  // --------------------------------------------------------------------------

  /**
   * Create a new LarkClient instance.
   *
   * @param config - Feishu configuration
   */
  constructor(config: FeishuConfig) {
    this._config = config;
    log.debug('LarkClient created', { appId: config.appId, brand: config.brand });
  }

  /** The configuration used by this client. */
  get config(): FeishuConfig {
    return this._config;
  }

  /** The App ID for this client. */
  get appId(): string {
    return this._config.appId;
  }

  /** The brand (feishu/lark) for this client. */
  get brand(): LarkBrand {
    return this._config.brand ?? 'feishu';
  }

  // ---- SDK client (lazy) ---------------------------------------------------

  /**
   * Get the Lark SDK client instance.
   * Lazily creates the client on first access.
   */
  get sdk(): Lark.Client {
    if (!this._sdk) {
      const { appId, appSecret } = this.requireCredentials();
      this._sdk = new Lark.Client({
        appId,
        appSecret,
        appType: Lark.AppType.SelfBuild,
        domain: resolveBrand(this._config.brand),
      });
      log.debug('SDK client created', { appId, brand: this._config.brand });
    }
    return this._sdk;
  }

  // ---- Bot identity ---------------------------------------------------------

  /**
   * Probe bot identity via the `bot/v3/info` API.
   * Results are cached on the instance for subsequent access via
   * `botOpenId` / `botName`.
   *
   * @param opts - Options including maxAgeMs for cache validity
   * @returns Probe result with bot info or error
   */
  async probe(opts?: { maxAgeMs?: number }): Promise<FeishuProbeResult> {
    const maxAge = opts?.maxAgeMs ?? 0;

    if (maxAge > 0 && this._lastProbeResult && Date.now() - this._lastProbeAt < maxAge) {
      return this._lastProbeResult;
    }

    if (!this._config.appId || !this._config.appSecret) {
      return { ok: false, error: 'missing credentials (appId, appSecret)' };
    }

    try {
      log.debug('Probing bot identity', { appId: this._config.appId });

      const res = await (this.sdk as any).request({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
        data: {},
      });

      if (res.code !== 0) {
        const result: FeishuProbeResult = {
          ok: false,
          appId: this._config.appId,
          error: `API error: ${res.msg || `code ${res.code}`}`,
        };
        this._lastProbeResult = result;
        this._lastProbeAt = Date.now();
        log.warn('Bot probe failed', { code: res.code, msg: res.msg });
        return result;
      }

      const bot = res.bot || res.data?.bot;
      this._botOpenId = bot?.open_id;
      this._botName = bot?.bot_name;

      const result: FeishuProbeResult = {
        ok: true,
        appId: this._config.appId,
        botName: this._botName,
        botOpenId: this._botOpenId,
      };
      this._lastProbeResult = result;
      this._lastProbeAt = Date.now();
      log.info('Bot identity probed', { botName: this._botName, botOpenId: this._botOpenId });
      return result;
    } catch (err) {
      const result: FeishuProbeResult = {
        ok: false,
        appId: this._config.appId,
        error: err instanceof Error ? err.message : String(err),
      };
      this._lastProbeResult = result;
      this._lastProbeAt = Date.now();
      log.error('Bot probe error', { error: result.error });
      return result;
    }
  }

  /** Cached bot open_id (available after `probe()`). */
  get botOpenId(): string | undefined {
    return this._botOpenId;
  }

  /** Cached bot name (available after `probe()`). */
  get botName(): string | undefined {
    return this._botName;
  }

  /** Last probe result (cached). */
  get lastProbeResult(): FeishuProbeResult | null {
    return this._lastProbeResult;
  }

  // ---- Token management ----------------------------------------------------

  /**
   * Get tenant access token.
   * This is primarily for debugging - the SDK handles tokens automatically.
   */
  async getTenantAccessToken(): Promise<string | null> {
    try {
      const res = await (this.sdk as any).request({
        method: 'POST',
        url: '/open-apis/auth/v3/tenant_access_token/internal',
        data: {
          app_id: this._config.appId,
          app_secret: this._config.appSecret,
        },
      });

      if (res.code !== 0) {
        log.warn('Failed to get tenant access token', { code: res.code, msg: res.msg });
        return null;
      }

      return res.tenant_access_token ?? null;
    } catch (err) {
      log.error('Error getting tenant access token', { error: err });
      return null;
    }
  }

  // ---- Utility methods ------------------------------------------------------

  /**
   * Clear cached probe result.
   * Call this to force a fresh probe on next call.
   */
  clearProbeCache(): void {
    this._lastProbeResult = null;
    this._lastProbeAt = 0;
    this._botOpenId = undefined;
    this._botName = undefined;
  }

  /**
   * Dispose of the client.
   * Clears all caches and the SDK client reference.
   */
  dispose(): void {
    log.debug('Disposing LarkClient', { appId: this._config.appId });
    this.clearProbeCache();
    this._sdk = null;
  }

  // ---- Private helpers ------------------------------------------------------

  /** Assert credentials exist or throw. */
  private requireCredentials(): { appId: string; appSecret: string } {
    const appId = this._config.appId;
    const appSecret = this._config.appSecret;
    if (!appId || !appSecret) {
      throw new Error(`LarkClient: appId and appSecret are required`);
    }
    return { appId, appSecret };
  }
}

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

/**
 * Get the singleton LarkClient instance.
 * Creates one from environment variables if not already created.
 */
export function getLarkClient(): LarkClient {
  return LarkClient.getInstance();
}

/**
 * Create a LarkClient from environment variables.
 * This will replace the singleton instance.
 */
export function createLarkClient(): LarkClient {
  return LarkClient.fromEnv();
}

/**
 * Reset the singleton LarkClient instance.
 * Useful for testing or when credentials change.
 */
export function resetLarkClient(): void {
  LarkClient.resetInstance();
}
