/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_calendar tool - Manage Feishu calendars.
 *
 * Actions: list, get, primary
 *
 * Uses the Feishu Calendar API:
 *   - list:    GET  /open-apis/calendar/v4/calendars
 *   - get:     GET  /open-apis/calendar/v4/calendars/:calendar_id
 *   - primary: POST /open-apis/calendar/v4/calendars/primary
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getToolAccessToken, isToolResult, withUserAccessToken } from '../common/auth-helper.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError, type ToolResult } from '../common/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:calendar:calendar');

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const listActionSchema = {
  action: z.literal('list').describe('List calendars'),
  page_size: z.number().min(1).max(1000).optional().describe('Page size (default 50)'),
  page_token: z.string().optional().describe('Pagination token'),
};

const getActionSchema = {
  action: z.literal('get').describe('Get calendar by ID'),
  calendar_id: z.string().describe('Calendar ID'),
};

const primaryActionSchema = {
  action: z.literal('primary').describe('Get primary calendar'),
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCalendarTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_calendar_list',
    description: [
      'List Feishu calendars.',
      '',
      'Parameters:',
      '- page_size: Page size (default 50)',
      '- page_token: Pagination token',
      '',
      'Returns list of calendars.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: listActionSchema,
    handler: async (args, context) => handleList(args, context),
  });

  registry.register({
    name: 'feishu_calendar_get',
    description: [
      'Get a Feishu calendar by ID.',
      '',
      'Parameters:',
      '- calendar_id: Calendar ID',
      '',
      'Returns calendar info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: getActionSchema,
    handler: async (args, context) => handleGet(args, context),
  });

  registry.register({
    name: 'feishu_calendar_primary',
    description: [
      'Get the primary Feishu calendar.',
      '',
      'Returns the primary calendar info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: primaryActionSchema,
    handler: async (args, context) => handlePrimary(args, context),
  });

  log.debug('feishu_calendar tools registered');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleList(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof listActionSchema>>>;
  const { larkClient } = context;

  const accessTokenResult = await getToolAccessToken(context);
  if (isToolResult(accessTokenResult)) return accessTokenResult;
  const accessToken = accessTokenResult;

  log.info(`list: page_size=${p.page_size ?? 50}, page_token=${p.page_token ?? 'none'}`);

  const opts = await withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.calendar.calendar.list(
    {
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
  const calendars = data?.calendar_list ?? [];

  log.info(`list: returned ${calendars.length} calendars`);

  return json({
    calendars,
    has_more: data?.has_more ?? false,
    page_token: data?.page_token,
  });
}

async function handleGet(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof getActionSchema>>>;
  const { larkClient } = context;

  if (!p.calendar_id) {
    return jsonError("calendar_id is required for 'get' action");
  }

  const accessTokenResult = await getToolAccessToken(context);
  if (isToolResult(accessTokenResult)) return accessTokenResult;
  const accessToken = accessTokenResult;

  log.info(`get: calendar_id=${p.calendar_id}`);

  const opts = await withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.calendar.calendar.get(
    {
      path: { calendar_id: p.calendar_id },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`get: retrieved calendar ${p.calendar_id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;

  return json({
    calendar: data?.calendar ?? res.data,
  });
}

async function handlePrimary(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const { larkClient } = context;

  const accessTokenResult = await getToolAccessToken(context);
  if (isToolResult(accessTokenResult)) return accessTokenResult;
  const accessToken = accessTokenResult;

  log.info(`primary: querying primary calendar`);

  const opts = await withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.calendar.calendar.primary({}, opts);
  assertLarkOk(res);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;
  const calendars = data?.calendars ?? [];

  log.info(`primary: returned ${calendars.length} primary calendars`);

  return json({
    calendars,
  });
}
