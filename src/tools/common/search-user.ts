/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_search_user tool - Search for users.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { json, jsonError, type ToolResult } from '../im/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:common:search-user');

// Schemas
const searchUserSchema = {
  query: z.string().describe('Search query (matches user name, phone, email)'),
  page_size: z.number().min(1).max(200).optional().describe('Page size (default 20)'),
  page_token: z.string().optional().describe('Pagination token'),
};

async function getAccessToken(context: {
  larkClient: LarkClient | null;
  config: import('../../core/types.js').FeishuConfig;
}): Promise<string | ToolResult> {
  const { larkClient, config } = context;
  if (!larkClient) return jsonError('LarkClient not initialized.');
  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');

  const { listStoredTokens } = await import('../../core/token-store.js');
  const tokens = await listStoredTokens(appId);
  if (tokens.length === 0) return jsonError('No user authorization found.');
  const userOpenId = tokens[0].userOpenId;

  try {
    return await getValidAccessToken({ userOpenId, appId, appSecret, domain: brand ?? 'feishu' });
  } catch (err) {
    if (err instanceof NeedAuthorizationError) return jsonError('User authorization expired.');
    throw err;
  }
}

export function registerSearchUserTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_search_user',
    description:
      'Search for Feishu users by name, phone, or email.\n\nRequires OAuth authorization.',
    inputSchema: searchUserSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof searchUserSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`search_user: query="${p.query}", page_size=${p.page_size ?? 20}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      // Build query parameters
      const queryParams: Record<string, string> = {
        query: p.query,
        page_size: String(p.page_size ?? 20),
      };
      if (p.page_token) queryParams.page_token = p.page_token;

      // Use direct request since SDK search API may not be fully typed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (larkClient!.sdk as any).request(
        {
          method: 'GET',
          url: '/open-apis/search/v1/user',
          params: queryParams,
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        opts
      );

      // Check for API error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((res as any).code !== undefined && (res as any).code !== 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return jsonError(`API Error: code=${(res as any).code}, msg=${(res as any).msg}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;
      const users = data?.users ?? [];

      log.info(`search_user: found ${users.length} users`);

      return json({
        users,
        has_more: data?.has_more ?? false,
        page_token: data?.page_token,
      });
    },
  });

  log.debug('feishu_search_user tool registered');
}
