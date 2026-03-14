/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_search_user tool - Search for users.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { getToolAccessToken, isToolResult, withUserAccessToken } from './auth-helper.js';
import { json, jsonError } from './helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:common:search-user');

// Schemas
const searchUserSchema = {
  query: z.string().describe('Search query (matches user name, phone, email)'),
  page_size: z.number().min(1).max(200).optional().describe('Page size (default 20)'),
  page_token: z.string().optional().describe('Pagination token'),
};


export function registerSearchUserTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_search_user',
    description:
      'Search for Feishu users by name, phone, or email.\n\nRequires OAuth authorization.',
    inputSchema: searchUserSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof searchUserSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`search_user: query="${p.query}", page_size=${p.page_size ?? 20}`);

      const opts = await withUserAccessToken(accessToken);

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
