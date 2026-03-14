/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_bitable_record tool - Manage Feishu Bitable records.
 *
 * Actions: create, list, update, delete, batch_create, batch_update, batch_delete
 *
 * Uses the Feishu Bitable v1 API:
 *   - create: POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records
 *   - list:   POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/search
 *   - update: PUT  /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id
 *   - delete: DELETE /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id
 *   - batch_create: POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/batch_create
 *   - batch_update: POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/batch_update
 *   - batch_delete: POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/batch_delete
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

const log = logger('tools:bitable:record');

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const filterConditionSchema = z.object({
  field_name: z.string().describe('Field name'),
  operator: z.enum(['is', 'isNot', 'contains', 'doesNotContain', 'isEmpty', 'isNotEmpty', 'isGreater', 'isGreaterEqual', 'isLess', 'isLessEqual']).describe('Filter operator'),
  value: z.array(z.string()).optional().describe('Filter value (omit for isEmpty/isNotEmpty)'),
});

const filterSchema = z.object({
  conjunction: z.enum(['and', 'or']).describe('Filter conjunction: and (all match) or or (any match)'),
  conditions: z.array(filterConditionSchema).describe('Filter conditions'),
});

const sortSchema = z.object({
  field_name: z.string().describe('Sort field name'),
  desc: z.boolean().describe('Sort descending'),
});

const createActionSchema = {
  action: z.literal('create').describe('Create a single record'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  fields: z.record(z.any()).describe('Record fields (key=field name, value depends on field type)'),
};

const listActionSchema = {
  action: z.literal('list').describe('List/search records'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  view_id: z.string().optional().describe('View ID (optional, recommended for better performance)'),
  field_names: z.array(z.string()).optional().describe('Field names to return (optional, returns all if not specified)'),
  filter: filterSchema.optional().describe('Filter conditions'),
  sort: z.array(sortSchema).optional().describe('Sort rules'),
  automatic_fields: z.boolean().optional().describe('Return automatic fields (created_time, last_modified_time, etc.)'),
  page_size: z.number().min(1).max(500).optional().describe('Page size (default 50)'),
  page_token: z.string().optional().describe('Pagination token'),
};

const updateActionSchema = {
  action: z.literal('update').describe('Update a single record'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  record_id: z.string().describe('Record ID'),
  fields: z.record(z.any()).describe('Fields to update'),
};

const deleteActionSchema = {
  action: z.literal('delete').describe('Delete a single record'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  record_id: z.string().describe('Record ID'),
};

const batchCreateActionSchema = {
  action: z.literal('batch_create').describe('Create multiple records at once (max 500)'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  records: z.array(z.object({ fields: z.record(z.any()) })).max(500).describe('Records to create'),
};

const batchUpdateActionSchema = {
  action: z.literal('batch_update').describe('Update multiple records at once (max 500)'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  records: z.array(z.object({ record_id: z.string(), fields: z.record(z.any()) })).max(500).describe('Records to update'),
};

const batchDeleteActionSchema = {
  action: z.literal('batch_delete').describe('Delete multiple records at once (max 500)'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  record_ids: z.array(z.string()).max(500).describe('Record IDs to delete'),
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerBitableRecordTool(registry: ToolRegistry): void {
  // Create single record
  registry.register({
    name: 'feishu_bitable_record_create',
    description: [
      'Create a single record in a Feishu Bitable table.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- fields: Record fields as key-value pairs',
      '',
      'Returns the created record.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: createActionSchema,
    handler: async (args, context) => handleCreate(args, context),
  });

  // List/search records
  registry.register({
    name: 'feishu_bitable_record_list',
    description: [
      'List or search records in a Feishu Bitable table.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- view_id: View ID (optional)',
      '- field_names: Field names to return (optional)',
      '- filter: Filter conditions (optional)',
      '- sort: Sort rules (optional)',
      '- automatic_fields: Return automatic fields (optional)',
      '- page_size: Page size (default 50)',
      '- page_token: Pagination token',
      '',
      'Returns list of records.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: listActionSchema,
    handler: async (args, context) => handleList(args, context),
  });

  // Update single record
  registry.register({
    name: 'feishu_bitable_record_update',
    description: [
      'Update a single record in a Feishu Bitable table.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- record_id: Record ID',
      '- fields: Fields to update',
      '',
      'Returns the updated record.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: updateActionSchema,
    handler: async (args, context) => handleUpdate(args, context),
  });

  // Delete single record
  registry.register({
    name: 'feishu_bitable_record_delete',
    description: [
      'Delete a single record from a Feishu Bitable table.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- record_id: Record ID',
      '',
      'Returns success status.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: deleteActionSchema,
    handler: async (args, context) => handleDelete(args, context),
  });

  // Batch create records
  registry.register({
    name: 'feishu_bitable_record_batch_create',
    description: [
      'Create multiple records in a Feishu Bitable table at once (max 500).',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- records: Array of records to create',
      '',
      'Returns created records.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: batchCreateActionSchema,
    handler: async (args, context) => handleBatchCreate(args, context),
  });

  // Batch update records
  registry.register({
    name: 'feishu_bitable_record_batch_update',
    description: [
      'Update multiple records in a Feishu Bitable table at once (max 500).',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- records: Array of records to update with record_id and fields',
      '',
      'Returns updated records.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: batchUpdateActionSchema,
    handler: async (args, context) => handleBatchUpdate(args, context),
  });

  // Batch delete records
  registry.register({
    name: 'feishu_bitable_record_batch_delete',
    description: [
      'Delete multiple records from a Feishu Bitable table at once (max 500).',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- record_ids: Array of record IDs to delete',
      '',
      'Returns success status.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: batchDeleteActionSchema,
    handler: async (args, context) => handleBatchDelete(args, context),
  });

  log.debug('feishu_bitable_record tools registered');
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

  if (!p.fields || Object.keys(p.fields).length === 0) {
    return jsonError('fields is required and cannot be empty');
  }

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`create: app_token=${p.app_token}, table_id=${p.table_id}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTableRecord.create(
    {
      path: { app_token: p.app_token, table_id: p.table_id },
      params: { user_id_type: 'open_id' as const },
      data: { fields: p.fields },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`create: created record ${res.data?.record?.record_id}`);

  return json({ record: res.data?.record });
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

  log.info(`list: app_token=${p.app_token}, table_id=${p.table_id}, view_id=${p.view_id ?? 'none'}, filter=${p.filter ? 'yes' : 'no'}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchData: any = {};
  if (p.view_id !== undefined) searchData.view_id = p.view_id;
  if (p.field_names !== undefined) searchData.field_names = p.field_names;

  // Handle isEmpty/isNotEmpty operators - they need empty value array
  if (p.filter !== undefined) {
    const filter = { ...p.filter };
    if (filter.conditions) {
      filter.conditions = filter.conditions.map((cond) => {
        if ((cond.operator === 'isEmpty' || cond.operator === 'isNotEmpty') && !cond.value) {
          log.warn(`list: ${cond.operator} operator detected without value. Auto-adding value=[] to avoid API error.`);
          return { ...cond, value: [] };
        }
        return cond;
      });
    }
    searchData.filter = filter;
  }

  if (p.sort !== undefined) searchData.sort = p.sort;
  if (p.automatic_fields !== undefined) searchData.automatic_fields = p.automatic_fields;

  const res = await larkClient!.sdk.bitable.appTableRecord.search(
    {
      path: { app_token: p.app_token, table_id: p.table_id },
      params: {
        user_id_type: 'open_id' as const,
        page_size: p.page_size,
        page_token: p.page_token,
      },
      data: searchData,
    },
    opts
  );
  assertLarkOk(res);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;

  log.info(`list: returned ${data?.items?.length ?? 0} records`);

  return json({
    records: data?.items,
    has_more: data?.has_more ?? false,
    page_token: data?.page_token,
    total: data?.total,
  });
}

async function handleUpdate(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof updateActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`update: app_token=${p.app_token}, table_id=${p.table_id}, record_id=${p.record_id}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTableRecord.update(
    {
      path: { app_token: p.app_token, table_id: p.table_id, record_id: p.record_id },
      params: { user_id_type: 'open_id' as const },
      data: { fields: p.fields },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`update: updated record ${p.record_id}`);

  return json({ record: res.data?.record });
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

  log.info(`delete: app_token=${p.app_token}, table_id=${p.table_id}, record_id=${p.record_id}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTableRecord.delete(
    {
      path: { app_token: p.app_token, table_id: p.table_id, record_id: p.record_id },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`delete: deleted record ${p.record_id}`);

  return json({ success: true });
}

async function handleBatchCreate(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof batchCreateActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`batch_create: app_token=${p.app_token}, table_id=${p.table_id}, records_count=${p.records.length}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTableRecord.batchCreate(
    {
      path: { app_token: p.app_token, table_id: p.table_id },
      params: { user_id_type: 'open_id' as const },
      data: { records: p.records },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`batch_create: created ${p.records.length} records`);

  return json({ records: res.data?.records });
}

async function handleBatchUpdate(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof batchUpdateActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`batch_update: app_token=${p.app_token}, table_id=${p.table_id}, records_count=${p.records.length}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTableRecord.batchUpdate(
    {
      path: { app_token: p.app_token, table_id: p.table_id },
      params: { user_id_type: 'open_id' as const },
      data: { records: p.records },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`batch_update: updated ${p.records.length} records`);

  return json({ records: res.data?.records });
}

async function handleBatchDelete(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof batchDeleteActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getAccessToken(context);
  if (typeof accessTokenResult === 'object' && 'content' in accessTokenResult) {
    return accessTokenResult;
  }
  const accessToken = accessTokenResult;

  log.info(`batch_delete: app_token=${p.app_token}, table_id=${p.table_id}, record_ids_count=${p.record_ids.length}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTableRecord.batchDelete(
    {
      path: { app_token: p.app_token, table_id: p.table_id },
      data: { records: p.record_ids },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`batch_delete: deleted ${p.record_ids.length} records`);

  return json({ success: true });
}
