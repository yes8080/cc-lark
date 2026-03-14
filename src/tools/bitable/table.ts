/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_bitable_table tool - Manage Feishu Bitable tables.
 *
 * Actions: create, list, patch, delete, batch_create, batch_delete
 *
 * Uses the Feishu Bitable v1 API:
 *   - create: POST /open-apis/bitable/v1/apps/:app_token/tables
 *   - list:   GET  /open-apis/bitable/v1/apps/:app_token/tables
 *   - patch:  PATCH /open-apis/bitable/v1/apps/:app_token/tables/:table_id
 *   - delete: DELETE /open-apis/bitable/v1/apps/:app_token/tables/:table_id
 *   - batch_create: POST /open-apis/bitable/v1/apps/:app_token/tables/batch_create
 *   - batch_delete: POST /open-apis/bitable/v1/apps/:app_token/tables/batch_delete
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

const log = logger('tools:bitable:table');

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const fieldSchema = z.object({
  field_name: z.string().describe('Field name'),
  type: z.number().describe('Field type (1=text, 2=number, 3=single_select, 4=multi_select, 5=date, 7=checkbox, 11=person, 13=phone, 15=url, 17=attachment, 1001=created_time, 1002=modified_time, etc.)'),
  property: z.any().optional().describe('Field property configuration (varies by type)'),
});

const createActionSchema = {
  action: z.literal('create').describe('Create a new table in the Bitable'),
  app_token: z.string().describe('Bitable app token'),
  table: z.object({
    name: z.string().describe('Table name'),
    default_view_name: z.string().optional().describe('Default view name'),
    fields: z.array(fieldSchema).optional().describe('Fields to create (recommended to define all fields at creation time)'),
  }).describe('Table configuration'),
};

const listActionSchema = {
  action: z.literal('list').describe('List tables in the Bitable'),
  app_token: z.string().describe('Bitable app token'),
  page_size: z.number().min(1).max(100).optional().describe('Page size (default 50)'),
  page_token: z.string().optional().describe('Pagination token'),
};

const patchActionSchema = {
  action: z.literal('patch').describe('Update table metadata'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  name: z.string().optional().describe('New table name'),
};

const deleteActionSchema = {
  action: z.literal('delete').describe('Delete a table'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
};

const batchCreateActionSchema = {
  action: z.literal('batch_create').describe('Create multiple tables at once'),
  app_token: z.string().describe('Bitable app token'),
  tables: z.array(z.object({
    name: z.string().describe('Table name'),
  })).describe('Tables to create'),
};

const batchDeleteActionSchema = {
  action: z.literal('batch_delete').describe('Delete multiple tables at once'),
  app_token: z.string().describe('Bitable app token'),
  table_ids: z.array(z.string()).describe('Table IDs to delete'),
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerBitableTableTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_bitable_table_create',
    description: [
      'Create a new table in a Feishu Bitable.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table: Table configuration with name and optional fields',
      '',
      'Returns the created table ID.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: createActionSchema,
    handler: async (args, context) => handleCreate(args, context),
  });

  registry.register({
    name: 'feishu_bitable_table_list',
    description: [
      'List tables in a Feishu Bitable.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- page_size: Page size (default 50)',
      '- page_token: Pagination token',
      '',
      'Returns list of tables.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: listActionSchema,
    handler: async (args, context) => handleList(args, context),
  });

  registry.register({
    name: 'feishu_bitable_table_patch',
    description: [
      'Update a Feishu Bitable table name.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- name: New table name',
      '',
      'Returns the updated table info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: patchActionSchema,
    handler: async (args, context) => handlePatch(args, context),
  });

  registry.register({
    name: 'feishu_bitable_table_delete',
    description: [
      'Delete a table from a Feishu Bitable.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '',
      'Returns success status.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: deleteActionSchema,
    handler: async (args, context) => handleDelete(args, context),
  });

  registry.register({
    name: 'feishu_bitable_table_batch_create',
    description: [
      'Create multiple tables in a Feishu Bitable at once.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- tables: Array of table configurations',
      '',
      'Returns created table IDs.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: batchCreateActionSchema,
    handler: async (args, context) => handleBatchCreate(args, context),
  });

  registry.register({
    name: 'feishu_bitable_table_batch_delete',
    description: [
      'Delete multiple tables from a Feishu Bitable at once.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_ids: Array of table IDs to delete',
      '',
      'Returns success status.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: batchDeleteActionSchema,
    handler: async (args, context) => handleBatchDelete(args, context),
  });

  log.debug('feishu_bitable_table tools registered');
}

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

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

  log.info(`create: app_token=${p.app_token}, table_name=${p.table.name}, fields_count=${p.table.fields?.length ?? 0}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  // Handle special case: checkbox (type=7) and URL (type=15) fields must not have property
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableData = { ...p.table } as any;
  if (tableData.fields) {
    tableData.fields = tableData.fields.map((field: { type: number; property?: unknown }) => {
      if ((field.type === 7 || field.type === 15) && field.property !== undefined) {
        const fieldTypeName = field.type === 15 ? 'URL' : 'Checkbox';
        log.warn(`create: ${fieldTypeName} field (type=${field.type}) detected with property. Removing property to avoid API error.`);
        const { property: _property, ...fieldWithoutProperty } = field;
        return fieldWithoutProperty;
      }
      return field;
    });
  }

  const res = await larkClient!.sdk.bitable.appTable.create(
    {
      path: { app_token: p.app_token },
      data: { table: tableData },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`create: created table ${res.data?.table_id}`);

  return json({
    table_id: res.data?.table_id,
    default_view_id: res.data?.default_view_id,
    field_id_list: res.data?.field_id_list,
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

  log.info(`list: app_token=${p.app_token}, page_size=${p.page_size ?? 50}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTable.list(
    {
      path: { app_token: p.app_token },
      params: {
        page_size: p.page_size,
        page_token: p.page_token,
      },
    },
    opts
  );
  assertLarkOk(res);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;

  log.info(`list: returned ${data?.items?.length ?? 0} tables`);

  return json({
    tables: data?.items,
    has_more: data?.has_more ?? false,
    page_token: data?.page_token,
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

  log.info(`patch: app_token=${p.app_token}, table_id=${p.table_id}, name=${p.name}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTable.patch(
    {
      path: {
        app_token: p.app_token,
        table_id: p.table_id,
      },
      data: { name: p.name },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`patch: updated table ${p.table_id}`);

  return json({
    name: res.data?.name,
  });
}

async function handleDelete(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof deleteActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`delete: app_token=${p.app_token}, table_id=${p.table_id}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTable.delete(
    {
      path: {
        app_token: p.app_token,
        table_id: p.table_id,
      },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`delete: deleted table ${p.table_id}`);

  return json({ success: true });
}

async function handleBatchCreate(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof batchCreateActionSchema>>>;
  const { larkClient } = context;

  if (!p.tables || p.tables.length === 0) {
    return jsonError('tables is required and cannot be empty');
  }

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`batch_create: app_token=${p.app_token}, tables_count=${p.tables.length}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTable.batchCreate(
    {
      path: { app_token: p.app_token },
      data: { tables: p.tables },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`batch_create: created ${p.tables.length} tables`);

  return json({
    table_ids: res.data?.table_ids,
  });
}

async function handleBatchDelete(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof batchDeleteActionSchema>>>;
  const { larkClient } = context;

  if (!p.table_ids || p.table_ids.length === 0) {
    return jsonError('table_ids is required and cannot be empty');
  }

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`batch_delete: app_token=${p.app_token}, table_ids_count=${p.table_ids.length}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTable.batchDelete(
    {
      path: { app_token: p.app_token },
      data: { table_ids: p.table_ids },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`batch_delete: deleted ${p.table_ids.length} tables`);

  return json({ success: true });
}
