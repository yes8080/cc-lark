/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_chat tool - Manage Feishu chats/groups.
 *
 * Actions: search, get
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { getToolAccessToken, isToolResult, withUserAccessToken } from '../common/auth-helper.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json } from '../common/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:chat:chat');

// Schemas
const searchActionSchema = {
  action: z.literal('search').describe('Search for chats'),
  query: z.string().describe('Search query (matches group name or member name)'),
  page_size: z.number().min(1).optional().describe('Page size (default 20)'),
  page_token: z.string().optional().describe('Pagination token'),
};

const getActionSchema = {
  action: z.literal('get').describe('Get chat info'),
  chat_id: z.string().describe('Chat ID (format: oc_xxx)'),
};


export function registerChatTool(registry: ToolRegistry): void {
  // Search chats
  registry.register({
    name: 'feishu_chat_search',
    description: 'Search for Feishu chats by name or member.\n\nRequires OAuth authorization.',
    inputSchema: searchActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof searchActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`search: query="${p.query}", page_size=${p.page_size ?? 20}`);

      const opts = await withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.im.v1.chat.search(
        {
          params: {
            user_id_type: 'open_id',
            query: p.query,
            page_size: p.page_size,
            page_token: p.page_token,
          },
        },
        opts
      );
      assertLarkOk(res);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;

      return json({
        items: data?.items,
        has_more: data?.has_more ?? false,
        page_token: data?.page_token,
      });
    },
  });

  // Get chat info
  registry.register({
    name: 'feishu_chat_get',
    description: 'Get Feishu chat info by ID.\n\nRequires OAuth authorization.',
    inputSchema: getActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof getActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`get: chat_id=${p.chat_id}`);

      const opts = await withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.im.v1.chat.get(
        {
          path: { chat_id: p.chat_id },
          params: { user_id_type: 'open_id' },
        },
        opts
      );
      assertLarkOk(res);

      return json({ chat: res.data });
    },
  });

  log.debug('feishu_chat tools registered');
}
