/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_bitable_app tool - Manage Feishu Bitable apps (multidimensional tables).
 *
 * Actions: create, get, list, patch, copy
 *
 * Uses the Feishu Bitable v1 API:
 *   - create: POST /open-apis/bitable/v1/apps
 *   - get:    GET  /open-apis/bitable/v1/apps/:app_token
 *   - list:   GET  /open-apis/drive/v1/files (filtered by type=bitable)
 *   - patch:  PATCH /open-apis/bitable/v1/apps/:app_token
 *   - copy:   POST /open-apis/bitable/v1/apps/:app_token/copy
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

const log = logger('tools:bitable:app');

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const createActionSchema = {
  action: z.literal('create').describe('Create a new Bitable app'),
  name: z.string().describe('Name of the Bitable app'),
  folder_token: z.string().optional().describe('Folder token (optional, defaults to My Space)'),
};

const getActionSchema = {
  action: z.literal('get').describe('Get Bitable app metadata'),
  app_token: z.string().describe('Bitable app token'),
};

const listActionSchema = {
  action: z.literal('list').describe('List Bitable apps in a folder'),
  folder_token: z.string().optional().describe('Folder token (optional, defaults to My Space)'),
  page_size: z.number().min(1).max(200).optional().describe('Page size (default 50)'),
  page_token: z.string().optional().describe('Pagination token'),
};

const patchActionSchema = {
  action: z.literal('patch').describe('Update Bitable app metadata'),
  app_token: z.string().describe('Bitable app token'),
  name: z.string().optional().describe('New name'),
  is_advanced: z.boolean().optional().describe('Enable advanced permissions'),
};

const copyActionSchema = {
  action: z.literal('copy').describe('Copy a Bitable app'),
  app_token: z.string().describe('Source Bitable app token'),
  name: z.string().describe('Name for the copy'),
  folder_token: z.string().optional().describe('Target folder token'),
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerBitableAppTool(registry: ToolRegistry): void {
  // Register create action
  registry.register({
    name: 'feishu_bitable_app_create',
    description: [
      'Create a new Feishu Bitable (multidimensional table).',
      '',
      'Parameters:',
      '- name: Name of the Bitable',
      '- folder_token: Optional folder token (defaults to My Space)',
      '',
      'Returns the created Bitable app token and info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: createActionSchema,
    handler: async (args, context) => handleCreate(args, context),
  });

  // Register get action
  registry.register({
    name: 'feishu_bitable_app_get',
    description: [
      'Get Feishu Bitable app metadata.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '',
      'Returns the Bitable app info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: getActionSchema,
    handler: async (args, context) => handleGet(args, context),
  });

  // Register list action
  registry.register({
    name: 'feishu_bitable_app_list',
    description: [
      'List Feishu Bitable apps in a folder.',
      '',
      'Parameters:',
      '- folder_token: Optional folder token (defaults to My Space)',
      '- page_size: Page size (default 50)',
      '- page_token: Pagination token',
      '',
      'Returns list of Bitable apps.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: listActionSchema,
    handler: async (args, context) => handleList(args, context),
  });

  // Register patch action
  registry.register({
    name: 'feishu_bitable_app_patch',
    description: [
      'Update Feishu Bitable app metadata.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- name: New name (optional)',
      '- is_advanced: Enable advanced permissions (optional)',
      '',
      'Returns the updated Bitable app info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: patchActionSchema,
    handler: async (args, context) => handlePatch(args, context),
  });

  // Register copy action
  registry.register({
    name: 'feishu_bitable_app_copy',
    description: [
      'Copy a Feishu Bitable app.',
      '',
      'Parameters:',
      '- app_token: Source Bitable app token',
      '- name: Name for the copy',
      '- folder_token: Target folder token (optional)',
      '',
      'Returns the new Bitable app token and info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: copyActionSchema,
    handler: async (args, context) => handleCopy(args, context),
  });

  log.debug('feishu_bitable_app tools registered');
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function getAccessToken(context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }): Promise<string | ToolResult> {
  const { larkClient, config } = context;
  if (!larkClient) {
    return jsonError('LarkClient not initialized. Check FEISHU_APP_ID and FEISHU_APP_SECRET.');
  }
  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) {
    return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');
  }

  const { listStoredTokens } = await import('../../core/token-store.js');
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
        `User authorization required or expired. Please use feishu_oauth tool with action="authorize" to re-authorize.`,
        { userOpenId }
      );
    }
    throw err;
  }
}

async function handleCreate(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof createActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`create: name=${p.name}, folder_token=${p.folder_token ?? 'my_space'}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = { name: p.name };
  if (p.folder_token) {
    data.folder_token = p.folder_token;
  }

  const res = await larkClient!.sdk.bitable.app.create({ data }, opts);
  assertLarkOk(res);

  log.info(`create: created app ${res.data?.app?.app_token}`);

  return json({
    app: res.data?.app,
  });
}

async function handleGet(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof getActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`get: app_token=${p.app_token}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.app.get(
    {
      path: { app_token: p.app_token },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`get: returned app ${p.app_token}`);

  return json({
    app: res.data?.app,
  });
}

async function handleList(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof listActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`list: folder_token=${p.folder_token ?? 'my_space'}, page_size=${p.page_size ?? 50}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.drive.v1.file.list(
    {
      params: {
        folder_token: p.folder_token || '',
        page_size: p.page_size,
        page_token: p.page_token,
      },
    },
    opts
  );
  assertLarkOk(res);

  // Filter for bitable type files
   
  const data = res.data as Record<string, unknown>;
   
  const bitables = (data?.files as Array<Record<string, unknown>>)?.filter((f) => f.type === 'bitable') || [];

  log.info(`list: returned ${bitables.length} bitable apps`);

  return json({
    apps: bitables,
    has_more: data?.has_more ?? false,
    page_token: data?.next_page_token,
  });
}

async function handlePatch(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof patchActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`patch: app_token=${p.app_token}, name=${p.name}, is_advanced=${p.is_advanced}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {};
  if (p.name !== undefined) updateData.name = p.name;
  if (p.is_advanced !== undefined) updateData.is_advanced = p.is_advanced;

  const res = await larkClient!.sdk.bitable.app.update(
    {
      path: { app_token: p.app_token },
      data: updateData,
    },
    opts
  );
  assertLarkOk(res);

  log.info(`patch: updated app ${p.app_token}`);

  return json({
    app: res.data?.app,
  });
}

async function handleCopy(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof copyActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`copy: app_token=${p.app_token}, name=${p.name}, folder_token=${p.folder_token ?? 'my_space'}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = { name: p.name };
  if (p.folder_token) {
    data.folder_token = p.folder_token;
  }

  const res = await larkClient!.sdk.bitable.app.copy(
    {
      path: { app_token: p.app_token },
      data,
    },
    opts
  );
  assertLarkOk(res);

  log.info(`copy: created copy ${res.data?.app?.app_token}`);

  return json({
    app: res.data?.app,
  });
}
