/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_bitable_field tool - Manage Feishu Bitable fields (columns).
 *
 * Actions: create, list, update, delete
 *
 * Uses the Feishu Bitable v1 API:
 *   - create: POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields
 *   - list:   GET  /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields
 *   - update: PUT  /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields/:field_id
 *   - delete: DELETE /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields/:field_id
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

const log = logger('tools:bitable:field');

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const createActionSchema = {
  action: z.literal('create').describe('Create a new field in the table'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  field_name: z.string().describe('Field name'),
  type: z.number().describe('Field type (1=text, 2=number, 3=single_select, 4=multi_select, 5=date, 7=checkbox, 11=person, 13=phone, 15=url, 17=attachment, 1001=created_time, 1002=modified_time, etc.)'),
  property: z.any().optional().describe('Field property configuration (varies by type). IMPORTANT: URL fields (type=15) and checkbox fields (type=7) must NOT have this parameter'),
};

const listActionSchema = {
  action: z.literal('list').describe('List fields in the table'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  view_id: z.string().optional().describe('View ID (optional)'),
  page_size: z.number().min(1).max(100).optional().describe('Page size (default 50)'),
  page_token: z.string().optional().describe('Pagination token'),
};

const updateActionSchema = {
  action: z.literal('update').describe('Update a field'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  field_id: z.string().describe('Field ID'),
  field_name: z.string().optional().describe('New field name (optional, will auto-fetch if not provided)'),
  type: z.number().optional().describe('Field type (optional, will auto-fetch if not provided)'),
  property: z.any().optional().describe('Field property configuration (optional)'),
};

const deleteActionSchema = {
  action: z.literal('delete').describe('Delete a field'),
  app_token: z.string().describe('Bitable app token'),
  table_id: z.string().describe('Table ID'),
  field_id: z.string().describe('Field ID'),
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerBitableFieldTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_bitable_field_create',
    description: [
      'Create a new field (column) in a Feishu Bitable table.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- field_name: Field name',
      '- type: Field type number',
      '- property: Field property configuration (optional, varies by type)',
      '',
      'IMPORTANT: URL fields (type=15) and checkbox fields (type=7) must NOT have property parameter.',
      '',
      'Returns the created field info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: createActionSchema,
    handler: async (args, context) => handleCreate(args, context),
  });

  registry.register({
    name: 'feishu_bitable_field_list',
    description: [
      'List fields (columns) in a Feishu Bitable table.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- view_id: View ID (optional)',
      '- page_size: Page size (default 50)',
      '- page_token: Pagination token',
      '',
      'Returns list of fields.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: listActionSchema,
    handler: async (args, context) => handleList(args, context),
  });

  registry.register({
    name: 'feishu_bitable_field_update',
    description: [
      'Update a field (column) in a Feishu Bitable table.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- field_id: Field ID',
      '- field_name: New field name (optional)',
      '- type: Field type (optional)',
      '- property: Field property configuration (optional)',
      '',
      'If type or field_name not provided, will auto-fetch current values.',
      'Returns the updated field info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: updateActionSchema,
    handler: async (args, context) => handleUpdate(args, context),
  });

  registry.register({
    name: 'feishu_bitable_field_delete',
    description: [
      'Delete a field (column) from a Feishu Bitable table.',
      '',
      'Parameters:',
      '- app_token: Bitable app token',
      '- table_id: Table ID',
      '- field_id: Field ID',
      '',
      'Returns success status.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: deleteActionSchema,
    handler: async (args, context) => handleDelete(args, context),
  });

  log.debug('feishu_bitable_field tools registered');
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

  log.info(`create: app_token=${p.app_token}, table_id=${p.table_id}, field_name=${p.field_name}, type=${p.type}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  // Handle special case: checkbox (type=7) and URL (type=15) fields must not have property
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let propertyToSend: any = p.property;
  if ((p.type === 15 || p.type === 7) && p.property !== undefined) {
    const fieldTypeName = p.type === 15 ? 'URL' : 'Checkbox';
    log.warn(`create: ${fieldTypeName} field (type=${p.type}) detected with property. Removing property to avoid API error.`);
    propertyToSend = undefined;
  }

  const res = await larkClient!.sdk.bitable.appTableField.create(
    {
      path: { app_token: p.app_token, table_id: p.table_id },
      data: {
        field_name: p.field_name,
        type: p.type,
        property: propertyToSend,
      },
    },
    opts
  );
  assertLarkOk(res);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;

  log.info(`create: created field ${data?.field?.field_id ?? 'unknown'}`);

  return json({ field: data?.field ?? res.data });
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

  log.info(`list: app_token=${p.app_token}, table_id=${p.table_id}, view_id=${p.view_id ?? 'none'}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTableField.list(
    {
      path: { app_token: p.app_token, table_id: p.table_id },
      params: {
        view_id: p.view_id,
        page_size: p.page_size,
        page_token: p.page_token,
      },
    },
    opts
  );
  assertLarkOk(res);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;

  log.info(`list: returned ${data?.items?.length ?? 0} fields`);

  return json({
    fields: data?.items,
    has_more: data?.has_more ?? false,
    page_token: data?.page_token,
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

  log.info(`update: app_token=${p.app_token}, table_id=${p.table_id}, field_id=${p.field_id}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  // If missing type or field_name, auto-query current field info
  let finalFieldName = p.field_name;
  let finalType = p.type;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let finalProperty: any = p.property;

  if (!finalType || !finalFieldName) {
    log.info(`update: missing type or field_name, auto-querying field info`);

    const listRes = await larkClient!.sdk.bitable.appTableField.list(
      {
        path: { app_token: p.app_token, table_id: p.table_id },
        params: { page_size: 500 },
      },
      opts
    );
    assertLarkOk(listRes);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listData = listRes.data as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentField = listData?.items?.find((f: any) => f.field_id === p.field_id);

    if (!currentField) {
      return jsonError(`field ${p.field_id} does not exist. Use list action to view all fields.`);
    }

    // Merge: user-provided values take precedence
    finalFieldName = p.field_name || currentField.field_name;
    finalType = p.type ?? currentField.type;
    finalProperty = p.property !== undefined ? p.property : currentField.property;

    log.info(`update: auto-filled type=${finalType}, field_name=${finalFieldName}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {
    field_name: finalFieldName,
    type: finalType,
  };
  if (finalProperty !== undefined) {
    updateData.property = finalProperty;
  }

  const res = await larkClient!.sdk.bitable.appTableField.update(
    {
      path: {
        app_token: p.app_token,
        table_id: p.table_id,
        field_id: p.field_id,
      },
      data: updateData,
    },
    opts
  );
  assertLarkOk(res);

  log.info(`update: updated field ${p.field_id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;

  return json({ field: data?.field ?? res.data });
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

  log.info(`delete: app_token=${p.app_token}, table_id=${p.table_id}, field_id=${p.field_id}`);

  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.bitable.appTableField.delete(
    {
      path: {
        app_token: p.app_token,
        table_id: p.table_id,
        field_id: p.field_id,
      },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`delete: deleted field ${p.field_id}`);

  return json({ success: true });
}
