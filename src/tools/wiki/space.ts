/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_wiki_space tool - Manage Feishu Wiki spaces.
 *
 * Actions: list, get, create
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError, type ToolResult } from '../im/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:wiki:space');

// Schemas
const listActionSchema = {
  action: z.literal('list').describe('List wiki spaces'),
  page_size: z.number().min(1).max(50).optional().describe('Page size (default 10)'),
  page_token: z.string().optional().describe('Pagination token'),
};

const getActionSchema = {
  action: z.literal('get').describe('Get a wiki space'),
  space_id: z.string().describe('Space ID'),
};

const createActionSchema = {
  action: z.literal('create').describe('Create a wiki space'),
  name: z.string().optional().describe('Space name'),
  description: z.string().optional().describe('Space description'),
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

export function registerWikiSpaceTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_wiki_space_list',
    description: 'List Feishu wiki spaces.\n\nRequires OAuth authorization.',
    inputSchema: listActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof listActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`list: page_size=${p.page_size ?? 10}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.wiki.space.list(
        { params: { page_size: p.page_size as any, page_token: p.page_token } },
        opts
      );
      assertLarkOk(res);

      const data = res.data as any;

      return json({
        spaces: data?.items,
        has_more: data?.has_more,
        page_token: data?.page_token,
      });
    },
  });

  registry.register({
    name: 'feishu_wiki_space_get',
    description: 'Get a Feishu wiki space by ID.\n\nRequires OAuth authorization.',
    inputSchema: getActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof getActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`get: space_id=${p.space_id}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.wiki.space.get({ path: { space_id: p.space_id } }, opts);
      assertLarkOk(res);

      return json({ space: res.data?.space });
    },
  });

  registry.register({
    name: 'feishu_wiki_space_create',
    description: 'Create a Feishu wiki space.\n\nRequires OAuth authorization.',
    inputSchema: createActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof createActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`create: name=${p.name ?? '(empty)'}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const data: any = {};
      if (p.name) data.name = p.name;
      if (p.description) data.description = p.description;

      const res = await larkClient!.sdk.wiki.space.create({ data }, opts);
      assertLarkOk(res);

      const spaceData = res.data?.space as any;

      return json({ space: res.data?.space, space_id: spaceData?.space_id });
    },
  });

  log.debug('feishu_wiki_space tools registered');
}
