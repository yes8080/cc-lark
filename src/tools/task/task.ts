/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Task Tools - Task management
 *
 * Actions: create, get, list, patch
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { getToolAccessToken, isToolResult, withUserAccessToken } from '../common/auth-helper.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError } from '../common/helpers.js';
import { parseTimeToTimestamp } from '../im/time-utils.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:task:task');

/**
 * Parse time string to Unix timestamp (milliseconds).
 * Wraps the shared parseTimeToTimestamp (seconds) and converts to milliseconds.
 */
function parseTimeToTimestampMs(input: string): string | null {
  const secondsStr = parseTimeToTimestamp(input);
  if (secondsStr === null) return null;
  return (parseInt(secondsStr, 10) * 1000).toString();
}

// Schemas
const createActionSchema = {
  action: z.literal('create').describe('Create a task'),
  summary: z.string().describe('Task title'),
  description: z.string().optional().describe('Task description'),
  due_timestamp: z.string().optional().describe('Due time (ISO 8601 with timezone)'),
  start_timestamp: z.string().optional().describe('Start time (ISO 8601 with timezone)'),
  completed: z.boolean().optional().describe('Whether completed'),
};

const getActionSchema = {
  action: z.literal('get').describe('Get a task'),
  task_guid: z.string().describe('Task GUID'),
};

const listActionSchema = {
  action: z.literal('list').describe('List tasks'),
  page_size: z.number().min(1).max(100).optional().describe('Page size (default 50)'),
  page_token: z.string().optional().describe('Pagination token'),
  completed: z.boolean().optional().describe('Filter by completion status'),
};

const patchActionSchema = {
  action: z.literal('patch').describe('Update a task'),
  task_guid: z.string().describe('Task GUID'),
  summary: z.string().optional().describe('New task title'),
  description: z.string().optional().describe('New task description'),
  due_timestamp: z.string().optional().describe('New due time (ISO 8601 with timezone)'),
  start_timestamp: z.string().optional().describe('New start time (ISO 8601 with timezone)'),
  completed: z.boolean().optional().describe('Mark as completed (true) or incomplete (false)'),
};


export function registerTaskTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_task_create',
    description: 'Create a Feishu task.\n\nRequires OAuth authorization.',
    inputSchema: createActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof createActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`create: summary=${p.summary}`);

      const opts = await withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taskData: any = { summary: p.summary };
      if (p.description) taskData.description = p.description;
      if (p.due_timestamp) {
        const ts = parseTimeToTimestampMs(p.due_timestamp);
        if (!ts)
          return jsonError(
            "Invalid due_timestamp format. Use ISO 8601 with timezone, e.g., '2024-01-01T00:00:00+08:00'"
          );
        taskData.due = { timestamp: ts, is_all_day: false };
      }
      if (p.start_timestamp) {
        const ts = parseTimeToTimestampMs(p.start_timestamp);
        if (!ts) return jsonError('Invalid start_timestamp format. Use ISO 8601 with timezone.');
        taskData.start = { timestamp: ts, is_all_day: false };
      }

      const res = await larkClient!.sdk.task.v2.task.create(
        { data: taskData, params: { user_id_type: 'open_id' } },
        opts
      );
      assertLarkOk(res);

      return json({ task: res.data?.task });
    },
  });

  registry.register({
    name: 'feishu_task_get',
    description: 'Get a Feishu task by GUID.\n\nRequires OAuth authorization.',
    inputSchema: getActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof getActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`get: task_guid=${p.task_guid}`);

      const opts = await withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.task.v2.task.get(
        { path: { task_guid: p.task_guid }, params: { user_id_type: 'open_id' } },
        opts
      );
      assertLarkOk(res);

      return json({ task: res.data?.task });
    },
  });

  registry.register({
    name: 'feishu_task_list',
    description: 'List Feishu tasks.\n\nRequires OAuth authorization.',
    inputSchema: listActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof listActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`list: page_size=${p.page_size ?? 50}, completed=${p.completed ?? 'all'}`);

      const opts = await withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.task.v2.task.list(
        {
          params: {
            page_size: p.page_size,
            page_token: p.page_token,
            completed: p.completed,
            user_id_type: 'open_id',
          },
        },
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
    name: 'feishu_task_patch',
    description: 'Update a Feishu task.\n\nRequires OAuth authorization.',
    inputSchema: patchActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof patchActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`patch: task_guid=${p.task_guid}`);

      const opts = await withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {};
      const updateFields: string[] = [];

      if (p.summary !== undefined) {
        updateData.summary = p.summary;
        updateFields.push('summary');
      }
      if (p.description !== undefined) {
        updateData.description = p.description;
        updateFields.push('description');
      }
      if (p.due_timestamp) {
        const ts = parseTimeToTimestampMs(p.due_timestamp);
        if (!ts) return jsonError('Invalid due_timestamp format.');
        updateData.due = { timestamp: ts, is_all_day: false };
        updateFields.push('due');
      }
      if (p.start_timestamp) {
        const ts = parseTimeToTimestampMs(p.start_timestamp);
        if (!ts) return jsonError('Invalid start_timestamp format.');
        updateData.start = { timestamp: ts, is_all_day: false };
        updateFields.push('start');
      }
      if (p.completed !== undefined) {
        updateData.completed_at = p.completed ? Date.now().toString() : '0';
        updateFields.push('completed_at');
      }

      const res = await larkClient!.sdk.task.v2.task.patch(
        {
          path: { task_guid: p.task_guid },
          data: { task: updateData, update_fields: updateFields },
          params: { user_id_type: 'open_id' },
        },
        opts
      );
      assertLarkOk(res);

      return json({ task: res.data?.task });
    },
  });

  log.debug('feishu_task tools registered');
}
