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
