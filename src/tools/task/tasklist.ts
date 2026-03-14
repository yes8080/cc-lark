/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tasklist Tools - Task list management
 *
 * Actions: create, get, list, tasks, patch, delete
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError, type ToolResult } from '../im/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:task:tasklist');

// Schemas
const createActionSchema = {
  action: z.literal('create').describe('Create a tasklist'),
  name: z.string().describe('Tasklist name'),
};

const getActionSchema = {
  action: z.literal('get').describe('Get a tasklist'),
  tasklist_guid: z.string().describe('Tasklist GUID'),
};

const listActionSchema = {
  action: z.literal('list').describe('List tasklists'),
  page_size: z.number().min(1).max(100).optional().describe('Page size (default 50)'),
  page_token: z.string().optional().describe('Pagination token'),
};

const tasksActionSchema = {
  action: z.literal('tasks').describe('List tasks in a tasklist'),
  tasklist_guid: z.string().describe('Tasklist GUID'),
  page_size: z.number().min(1).max(100).optional().describe('Page size (default 50)'),
  page_token: z.string().optional().describe('Pagination token'),
  completed: z.boolean().optional().describe('Filter by completion status'),
};

const patchActionSchema = {
  action: z.literal('patch').describe('Update a tasklist'),
  tasklist_guid: z.string().describe('Tasklist GUID'),
  name: z.string().optional().describe('New tasklist name'),
};

const deleteActionSchema = {
  action: z.literal('delete').describe('Delete a tasklist'),
  tasklist_guid: z.string().describe('Tasklist GUID'),
};

async function getAccessToken(context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }): Promise<string | ToolResult> {
  const { larkClient, config } = context;
  if (!larkClient) return jsonError('LarkClient not initialized.');
  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');

  const { listStoredTokens } = await import('../../core/token-store.js');
  const tokens = await listStoredTokens(appId);
  if (tokens.length === 0) return jsonError('No user authorization found. Use feishu_oauth tool first.');
  const userOpenId = tokens[0].userOpenId;

  try {
    return await getValidAccessToken({ userOpenId, appId, appSecret, domain: brand ?? 'feishu' });
  } catch (err) {
    if (err instanceof NeedAuthorizationError) return jsonError('User authorization expired. Re-authorize with feishu_oauth.');
    throw err;
  }
}

export function registerTasklistTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_tasklist_create',
    description: 'Create a Feishu tasklist.\n\nRequires OAuth authorization.',
    inputSchema: createActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof createActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`create: name=${p.name}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.task.v2.tasklist.create(
        { data: { name: p.name }, params: { user_id_type: 'open_id' } },
        opts
      );
      assertLarkOk(res);

      return json({ tasklist: res.data?.tasklist });
    },
  });

  registry.register({
    name: 'feishu_tasklist_get',
    description: 'Get a Feishu tasklist by GUID.\n\nRequires OAuth authorization.',
    inputSchema: getActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof getActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`get: tasklist_guid=${p.tasklist_guid}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.task.v2.tasklist.get(
        { path: { tasklist_guid: p.tasklist_guid }, params: { user_id_type: 'open_id' } },
        opts
      );
      assertLarkOk(res);

      return json({ tasklist: res.data?.tasklist });
    },
  });

  registry.register({
    name: 'feishu_tasklist_list',
    description: 'List Feishu tasklists.\n\nRequires OAuth authorization.',
    inputSchema: listActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof listActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`list: page_size=${p.page_size ?? 50}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.task.v2.tasklist.list(
        { params: { page_size: p.page_size, page_token: p.page_token, user_id_type: 'open_id' } },
        opts
      );
      assertLarkOk(res);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;

      return json({
        tasklists: data?.items,
        has_more: data?.has_more ?? false,
        page_token: data?.page_token,
      });
    },
  });

  registry.register({
    name: 'feishu_tasklist_tasks',
    description: 'List tasks in a Feishu tasklist.\n\nRequires OAuth authorization.',
    inputSchema: tasksActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof tasksActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`tasks: tasklist_guid=${p.tasklist_guid}, completed=${p.completed ?? 'all'}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.task.v2.tasklist.tasks(
        { path: { tasklist_guid: p.tasklist_guid }, params: { page_size: p.page_size, page_token: p.page_token, completed: p.completed, user_id_type: 'open_id' } },
        opts
      );
      assertLarkOk(res);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;

      return json({
        tasks: data?.items,
        has_more: data?.has_more ?? false,
        page_token: data?.page_token,
      });
    },
  });

  registry.register({
    name: 'feishu_tasklist_patch',
    description: 'Update a Feishu tasklist.\n\nRequires OAuth authorization.',
    inputSchema: patchActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof patchActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`patch: tasklist_guid=${p.tasklist_guid}, name=${p.name}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tasklistData: any = {};
      const updateFields: string[] = [];
      if (p.name !== undefined) { tasklistData.name = p.name; updateFields.push('name'); }

      if (updateFields.length === 0) return jsonError('No fields to update');

      const res = await larkClient!.sdk.task.v2.tasklist.patch(
        { path: { tasklist_guid: p.tasklist_guid }, data: { tasklist: tasklistData, update_fields: updateFields }, params: { user_id_type: 'open_id' } },
        opts
      );
      assertLarkOk(res);

      return json({ tasklist: res.data?.tasklist });
    },
  });

  registry.register({
    name: 'feishu_tasklist_delete',
    description: 'Delete a Feishu tasklist.\n\nRequires OAuth authorization.',
    inputSchema: deleteActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof deleteActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      log.info(`delete: tasklist_guid=${p.tasklist_guid}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.task.v2.tasklist.delete(
        { path: { tasklist_guid: p.tasklist_guid } },
        opts
      );
      assertLarkOk(res);

      return json({ success: true });
    },
  });

  log.debug('feishu_tasklist tools registered');
}
