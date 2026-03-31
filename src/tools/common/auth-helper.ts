/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Shared authentication helper for tool modules.
 *
 * Consolidates the repeated getAccessToken() pattern used across all tools
 * into a single reusable function.
 */

import type { LarkClient } from '../../core/lark-client.js';
import type { FeishuConfig } from '../../core/types.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { listStoredTokens } from '../../core/token-store.js';
import { jsonError, type ToolResult } from './helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:auth-helper');

/**
 * Context required for tool access token retrieval.
 */
export interface AuthContext {
  larkClient: LarkClient | null;
  config: FeishuConfig;
}

/**
 * Check whether a result is a ToolResult (error response) rather than an access token string.
 */
export function isToolResult(result: string | ToolResult): result is ToolResult {
  return typeof result === 'object' && 'content' in result;
}

/**
 * Get a valid user access token for tool execution.
 *
 * Validates the tool context, retrieves stored tokens, and returns a fresh
 * access token (refreshing if needed). Returns a ToolResult error if any
 * step fails.
 *
 * @param context - Tool context containing larkClient and config
 * @returns Access token string on success, or ToolResult error
 */
export async function getToolAccessToken(context: AuthContext): Promise<string | ToolResult> {
  const { larkClient, config } = context;
  if (!larkClient) {
    return jsonError('LarkClient not initialized. Check FEISHU_APP_ID and FEISHU_APP_SECRET.');
  }

  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) {
    return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');
  }

  const tokens = await listStoredTokens(appId);
  if (tokens.length === 0) {
    return jsonError(
      'No user authorization found. Please use the feishu_oauth tool with action="authorize" to authorize a user first.'
    );
  }

  const userOpenId = tokens[0].userOpenId;

  try {
    return await getValidAccessToken({
      userOpenId,
      appId,
      appSecret,
      domain: brand ?? 'feishu',
    });
  } catch (err) {
    if (err instanceof NeedAuthorizationError) {
      return jsonError(
        'User authorization required or expired. Please use feishu_oauth tool with action="authorize" to re-authorize.',
        { userOpenId }
      );
    }
    throw err;
  }
}

/**
 * Get Lark SDK options with user access token.
 *
 * Helper to avoid repeated `await import('@larksuiteoapi/node-sdk')` calls.
 *
 * @param accessToken - User access token
 * @returns Lark SDK request options with user access token
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withUserAccessToken(accessToken: string): Promise<any> {
  const Lark = await import('@larksuiteoapi/node-sdk');
  return Lark.withUserAccessToken(accessToken);
}

// ---------------------------------------------------------------------------
// Tenant-fallback auth (for bitable and other tools that support tenant token)
// ---------------------------------------------------------------------------

/** Sentinel value indicating tenant_access_token should be used. */
export const TENANT_TOKEN = 'tenant' as const;

/**
 * Get a valid access token, falling back to tenant_access_token when no
 * user authorization exists or has expired.
 *
 * - If a valid UAT is available → returns the UAT string.
 * - If no UAT or UAT is expired → returns TENANT_TOKEN sentinel.
 * - If infrastructure is broken (no client/credentials) → returns ToolResult error.
 *
 * Use with `withAccessToken()` to create the appropriate SDK request options.
 */
export async function getToolAccessTokenWithTenantFallback(
  context: AuthContext
): Promise<string | typeof TENANT_TOKEN | ToolResult> {
  const { larkClient, config } = context;
  if (!larkClient) {
    return jsonError('LarkClient not initialized. Check FEISHU_APP_ID and FEISHU_APP_SECRET.');
  }

  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) {
    return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');
  }

  // Try UAT first
  const tokens = await listStoredTokens(appId);
  if (tokens.length === 0) {
    log.info('No UAT stored — falling back to tenant_access_token');
    return TENANT_TOKEN;
  }

  const userOpenId = tokens[0].userOpenId;

  try {
    return await getValidAccessToken({
      userOpenId,
      appId,
      appSecret,
      domain: brand ?? 'feishu',
    });
  } catch (err) {
    if (err instanceof NeedAuthorizationError) {
      log.info(`UAT expired for ${userOpenId} — falling back to tenant_access_token`);
      return TENANT_TOKEN;
    }
    throw err;
  }
}

/**
 * Create SDK request options based on token type.
 *
 * - UAT string → returns `withUserAccessToken(token)` options.
 * - TENANT_TOKEN → returns `undefined` so the SDK falls back to its
 *   internal `tenant_access_token` (obtained via app credentials).
 *
 * NOTE: The `undefined` return relies on the Lark Node SDK treating a
 * missing options argument as "use tenant_access_token".  If the SDK
 * changes this behaviour, this function must be updated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withAccessToken(token: string | typeof TENANT_TOKEN): Promise<any> {
  if (token === TENANT_TOKEN) return undefined;
  const Lark = await import('@larksuiteoapi/node-sdk');
  return Lark.withUserAccessToken(token);
}
