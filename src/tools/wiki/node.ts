/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_wiki_node tool - Manage Feishu Wiki nodes.
 *
 * Actions: list, get
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError, type ToolResult } from '../im/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:wiki:node');

// Schemas
const listActionSchema = {
  action: z.literal('list').describe('List wiki nodes in a space'),
  space_id: z.string().describe('Space ID'),
  parent_node_token: z
    .string()
    .optional()
    .describe('Parent node token (optional, for listing sub-nodes)'),
  page_size: z.number().min(1).max(50).optional().describe('Page size (default 50)'),
  page_token: z.string().optional().describe('Pagination token'),
};

const getActionSchema = {
  action: z.literal('get').describe('Get a wiki node'),
  token: z.string().describe('Node token'),
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

export function registerWikiNodeTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_wiki_node_list',
    description: 'List Feishu wiki nodes in a space.\n\nRequires OAuth authorization.',
    inputSchema: listActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof listActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`list: space_id=${p.space_id}, parent=${p.parent_node_token ?? 'root'}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.wiki.spaceNode.list(
        {
          path: { space_id: p.space_id },
          params: {
            parent_node_token: p.parent_node_token,
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
        nodes: data?.items,
        has_more: data?.has_more,
        page_token: data?.page_token,
      });
    },
  });

  registry.register({
    name: 'feishu_wiki_node_get',
    description: 'Get a Feishu wiki node by token.\n\nRequires OAuth authorization.',
    inputSchema: getActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof getActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`get: token=${p.token}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      // Use direct request since SDK doesn't have a get method for node
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (larkClient!.sdk as any).request(
        {
          method: 'GET',
          url: `/open-apis/wiki/v2/spaces/get_node?token=${p.token}`,
        },
        opts
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((res as any).code !== undefined && (res as any).code !== 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return jsonError(`API Error: code=${(res as any).code}, msg=${(res as any).msg}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return json({ node: (res as any).data?.node });
    },
  });

  log.debug('feishu_wiki_node tools registered');
}
