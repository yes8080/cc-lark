/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_chat_members tool - Get chat members.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError, type ToolResult } from '../im/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:chat:members');

// Schemas
const membersActionSchema = {
  chat_id: z.string().describe('Chat ID (format: oc_xxx)'),
  member_id_type: z
    .enum(['open_id', 'union_id', 'user_id'])
    .optional()
    .describe('Member ID type (default: open_id)'),
  page_size: z.number().min(1).optional().describe('Page size (default 20)'),
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

export function registerChatMembersTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_chat_members',
    description: 'Get members of a Feishu chat.\n\nRequires OAuth authorization.',
    inputSchema: membersActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof membersActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`members: chat_id="${p.chat_id}", page_size=${p.page_size ?? 20}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.im.v1.chatMembers.get(
        {
          path: { chat_id: p.chat_id },
          params: {
            member_id_type: p.member_id_type || 'open_id',
            page_size: p.page_size,
            page_token: p.page_token,
          },
        },
        opts
      );
      assertLarkOk(res);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;
      const memberCount = data?.items?.length ?? 0;
      const memberTotal = data?.member_total ?? 0;

      log.info(`members: found ${memberCount} members (total: ${memberTotal})`);

      return json({
        items: data?.items,
        has_more: data?.has_more ?? false,
        page_token: data?.page_token,
        member_total: memberTotal,
      });
    },
  });

  log.debug('feishu_chat_members tool registered');
}
