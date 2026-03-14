/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_calendar_event tool - Manage Feishu calendar events.
 *
 * Actions: create, list, get, patch, delete
 *
 * Uses the Feishu Calendar API:
 *   - create: POST /open-apis/calendar/v4/calendars/:calendar_id/events
 *   - list:   GET  /open-apis/calendar/v4/calendars/:calendar_id/events/instance_view
 *   - get:    GET  /open-apis/calendar/v4/calendars/:calendar_id/events/:event_id
 *   - patch:  PATCH /open-apis/calendar/v4/calendars/:calendar_id/events/:event_id
 *   - delete: DELETE /open-apis/calendar/v4/calendars/:calendar_id/events/:event_id
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

const log = logger('tools:calendar:event');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse time string to Unix timestamp (seconds).
 * Supports ISO 8601 with timezone or Beijing time (UTC+8) without timezone.
 */
function parseTimeToTimestamp(input: string): string | null {
  try {
    const trimmed = input.trim();
    const hasTimezone = /[Zz]$|[+-]\d{2}:\d{2}$/.test(trimmed);

    if (hasTimezone) {
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return Math.floor(date.getTime() / 1000).toString();
    }

    // No timezone - treat as Beijing time (UTC+8)
    const normalized = trimmed.replace('T', ' ');
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);

    if (!match) {
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) return null;
      return Math.floor(date.getTime() / 1000).toString();
    }

    const [, year, month, day, hour, minute, second] = match;
    const utcDate = new Date(
      Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour) - 8, // Beijing time - 8 hours = UTC
        parseInt(minute),
        parseInt(second ?? '0')
      )
    );

    return Math.floor(utcDate.getTime() / 1000).toString();
  } catch {
    return null;
  }
}

/**
 * Convert Unix timestamp to ISO 8601 string in Shanghai timezone.
 */
function unixTimestampToISO8601(raw: string | number | undefined): string | null {
  if (raw === undefined || raw === null) return null;

  const text = typeof raw === 'number' ? String(raw) : String(raw).trim();
  if (!/^-?\d+$/.test(text)) return null;

  const num = Number(text);
  if (!Number.isFinite(num)) return null;

  const utcMs = Math.abs(num) >= 1e12 ? num : num * 1000;
  const beijingDate = new Date(utcMs + 8 * 60 * 60 * 1000);
  if (Number.isNaN(beijingDate.getTime())) return null;

  const year = beijingDate.getUTCFullYear();
  const month = String(beijingDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getUTCDate()).padStart(2, '0');
  const hour = String(beijingDate.getUTCHours()).padStart(2, '0');
  const minute = String(beijingDate.getUTCMinutes()).padStart(2, '0');
  const second = String(beijingDate.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const createActionSchema = {
  action: z.literal('create').describe('Create a calendar event'),
  summary: z.string().optional().describe('Event title (recommended)'),
  start_time: z
    .string()
    .describe('Start time (ISO 8601 with timezone, e.g., 2024-01-01T00:00:00+08:00)'),
  end_time: z
    .string()
    .describe('End time (ISO 8601 with timezone, e.g., 2024-01-01T01:00:00+08:00)'),
  calendar_id: z
    .string()
    .optional()
    .describe('Calendar ID (optional, uses primary if not provided)'),
  description: z.string().optional().describe('Event description'),
  location_name: z.string().optional().describe('Location name'),
};

const listActionSchema = {
  action: z.literal('list').describe('List calendar events in a time range'),
  start_time: z.string().describe('Start time (ISO 8601 with timezone, max 40 days range)'),
  end_time: z.string().describe('End time (ISO 8601 with timezone, max 40 days range)'),
  calendar_id: z
    .string()
    .optional()
    .describe('Calendar ID (optional, uses primary if not provided)'),
};

const getActionSchema = {
  action: z.literal('get').describe('Get a calendar event by ID'),
  event_id: z.string().describe('Event ID'),
  calendar_id: z
    .string()
    .optional()
    .describe('Calendar ID (optional, uses primary if not provided)'),
};

const patchActionSchema = {
  action: z.literal('patch').describe('Update a calendar event'),
  event_id: z.string().describe('Event ID'),
  calendar_id: z
    .string()
    .optional()
    .describe('Calendar ID (optional, uses primary if not provided)'),
  summary: z.string().optional().describe('New event title'),
  description: z.string().optional().describe('New event description'),
  start_time: z.string().optional().describe('New start time (ISO 8601 with timezone)'),
  end_time: z.string().optional().describe('New end time (ISO 8601 with timezone)'),
};

const deleteActionSchema = {
  action: z.literal('delete').describe('Delete a calendar event'),
  event_id: z.string().describe('Event ID'),
  calendar_id: z
    .string()
    .optional()
    .describe('Calendar ID (optional, uses primary if not provided)'),
  need_notification: z.boolean().optional().describe('Whether to notify attendees (default true)'),
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCalendarEventTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_calendar_event_create',
    description: [
      'Create a Feishu calendar event.',
      '',
      'Parameters:',
      '- summary: Event title (recommended)',
      '- start_time: Start time (ISO 8601 with timezone)',
      '- end_time: End time (ISO 8601 with timezone)',
      '- calendar_id: Calendar ID (optional)',
      '- description: Event description (optional)',
      '- location_name: Location name (optional)',
      '',
      'Returns the created event.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: createActionSchema,
    handler: async (args, context) => handleCreate(args, context),
  });

  registry.register({
    name: 'feishu_calendar_event_list',
    description: [
      'List Feishu calendar events in a time range.',
      '',
      'Parameters:',
      '- start_time: Start time (ISO 8601 with timezone, max 40 days range)',
      '- end_time: End time (ISO 8601 with timezone, max 40 days range)',
      '- calendar_id: Calendar ID (optional)',
      '',
      'Returns list of events.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: listActionSchema,
    handler: async (args, context) => handleList(args, context),
  });

  registry.register({
    name: 'feishu_calendar_event_get',
    description: [
      'Get a Feishu calendar event by ID.',
      '',
      'Parameters:',
      '- event_id: Event ID',
      '- calendar_id: Calendar ID (optional)',
      '',
      'Returns the event info.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: getActionSchema,
    handler: async (args, context) => handleGet(args, context),
  });

  registry.register({
    name: 'feishu_calendar_event_patch',
    description: [
      'Update a Feishu calendar event.',
      '',
      'Parameters:',
      '- event_id: Event ID',
      '- calendar_id: Calendar ID (optional)',
      '- summary: New event title (optional)',
      '- description: New event description (optional)',
      '- start_time: New start time (optional)',
      '- end_time: New end time (optional)',
      '',
      'Returns the updated event.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: patchActionSchema,
    handler: async (args, context) => handlePatch(args, context),
  });

  registry.register({
    name: 'feishu_calendar_event_delete',
    description: [
      'Delete a Feishu calendar event.',
      '',
      'Parameters:',
      '- event_id: Event ID',
      '- calendar_id: Calendar ID (optional)',
      '- need_notification: Whether to notify attendees (default true)',
      '',
      'Returns success status.',
      'Requires OAuth authorization.',
    ].join('\n'),
    inputSchema: deleteActionSchema,
    handler: async (args, context) => handleDelete(args, context),
  });

  log.debug('feishu_calendar_event tools registered');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


async function resolveCalendarId(
  calendarId: string | undefined,
  larkClient: LarkClient,
  accessToken: string
): Promise<string> {
  if (calendarId) return calendarId;

  const opts = await withUserAccessToken(accessToken);

  const res = await larkClient.sdk.calendar.calendar.primary({}, opts);
  assertLarkOk(res);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;
  const cid = data?.calendars?.[0]?.calendar?.calendar_id;

  if (!cid) {
    throw new Error('Could not determine primary calendar');
  }

  log.info(`resolveCalendarId: primary() returned calendar_id=${cid}`);
  return cid;
}

function normalizeEventTimeFields(
  event: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!event) return event;

  const normalized: Record<string, unknown> = { ...event };

  const startTime = event.start_time;
  if (startTime && typeof startTime === 'object' && 'timestamp' in startTime) {
    const ts = (startTime as { timestamp?: unknown }).timestamp;
    const iso = unixTimestampToISO8601(ts as string | number | undefined);
    if (iso) {
      normalized.start_time = iso;
    }
  }

  const endTime = event.end_time;
  if (endTime && typeof endTime === 'object' && 'timestamp' in endTime) {
    const ts = (endTime as { timestamp?: unknown }).timestamp;
    const iso = unixTimestampToISO8601(ts as string | number | undefined);
    if (iso) {
      normalized.end_time = iso;
    }
  }

  return normalized;
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

  if (!p.start_time || !p.end_time) {
    return jsonError('start_time and end_time are required');
  }

  const startTs = parseTimeToTimestamp(p.start_time);
  const endTs = parseTimeToTimestamp(p.end_time);

  if (!startTs || !endTs) {
    return jsonError(
      "Invalid time format. Must use ISO 8601 with timezone, e.g., '2024-01-01T00:00:00+08:00'",
      { received_start: p.start_time, received_end: p.end_time }
    );
  }

  const accessTokenResult = await getToolAccessToken(context);
  if (isToolResult(accessTokenResult)) return accessTokenResult;
  const accessToken = accessTokenResult;

  const calendarId = await resolveCalendarId(p.calendar_id, larkClient!, accessToken);

  log.info(
    `create: summary=${p.summary ?? '(none)'}, start_time=${startTs}, end_time=${endTs}, calendar_id=${calendarId}`
  );

  const opts = await withUserAccessToken(accessToken);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventData: any = {
    summary: p.summary,
    start_time: { timestamp: startTs },
    end_time: { timestamp: endTs },
    need_notification: true,
  };
  if (p.description) eventData.description = p.description;
  if (p.location_name) eventData.location = { name: p.location_name };

  const res = await larkClient!.sdk.calendar.calendarEvent.create(
    {
      path: { calendar_id: calendarId },
      data: eventData,
    },
    opts
  );
  assertLarkOk(res);

  log.info(`create: event created, event_id=${res.data?.event?.event_id}`);

  return json({
    event: normalizeEventTimeFields(res.data?.event as Record<string, unknown> | undefined),
    calendar_id: calendarId,
  });
}

async function handleList(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof listActionSchema>>>;
  const { larkClient } = context;

  if (!p.start_time || !p.end_time) {
    return jsonError('start_time and end_time are required');
  }

  const startTs = parseTimeToTimestamp(p.start_time);
  const endTs = parseTimeToTimestamp(p.end_time);

  if (!startTs || !endTs) {
    return jsonError(
      "Invalid time format. Must use ISO 8601 with timezone, e.g., '2024-01-01T00:00:00+08:00'",
      { received_start: p.start_time, received_end: p.end_time }
    );
  }

  const accessTokenResult = await getToolAccessToken(context);
  if (isToolResult(accessTokenResult)) return accessTokenResult;
  const accessToken = accessTokenResult;

  const calendarId = await resolveCalendarId(p.calendar_id, larkClient!, accessToken);

  log.info(`list: calendar_id=${calendarId}, start_time=${startTs}, end_time=${endTs}`);

  const opts = await withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.calendar.calendarEvent.instanceView(
    {
      path: { calendar_id: calendarId },
      params: {
        start_time: startTs,
        end_time: endTs,
        user_id_type: 'open_id' as const,
      },
    },
    opts
  );
  assertLarkOk(res);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;

  log.info(`list: returned ${data?.items?.length ?? 0} events`);

  // Normalize time fields
  const events = (data?.items ?? []).map((item: unknown) =>
    normalizeEventTimeFields(item as Record<string, unknown>)
  );

  return json({
    events,
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

  if (!p.event_id) {
    return jsonError('event_id is required');
  }

  const accessTokenResult = await getToolAccessToken(context);
  if (isToolResult(accessTokenResult)) return accessTokenResult;
  const accessToken = accessTokenResult;

  const calendarId = await resolveCalendarId(p.calendar_id, larkClient!, accessToken);

  log.info(`get: calendar_id=${calendarId}, event_id=${p.event_id}`);

  const opts = await withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.calendar.calendarEvent.get(
    {
      path: { calendar_id: calendarId, event_id: p.event_id },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`get: retrieved event ${p.event_id}`);

  return json({
    event: normalizeEventTimeFields(res.data?.event as Record<string, unknown> | undefined),
  });
}

async function handlePatch(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof patchActionSchema>>>;
  const { larkClient } = context;

  if (!p.event_id) {
    return jsonError('event_id is required');
  }

  const accessTokenResult = await getToolAccessToken(context);
  if (isToolResult(accessTokenResult)) return accessTokenResult;
  const accessToken = accessTokenResult;

  const calendarId = await resolveCalendarId(p.calendar_id, larkClient!, accessToken);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {};

  if (p.start_time) {
    const startTs = parseTimeToTimestamp(p.start_time);
    if (!startTs) {
      return jsonError(
        "Invalid start_time format. Must use ISO 8601 with timezone, e.g., '2024-01-01T00:00:00+08:00'"
      );
    }
    updateData.start_time = { timestamp: startTs };
  }

  if (p.end_time) {
    const endTs = parseTimeToTimestamp(p.end_time);
    if (!endTs) {
      return jsonError(
        "Invalid end_time format. Must use ISO 8601 with timezone, e.g., '2024-01-01T00:00:00+08:00'"
      );
    }
    updateData.end_time = { timestamp: endTs };
  }

  if (p.summary) updateData.summary = p.summary;
  if (p.description) updateData.description = p.description;

  log.info(
    `patch: calendar_id=${calendarId}, event_id=${p.event_id}, fields=${Object.keys(updateData).join(',')}`
  );

  const opts = await withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.calendar.calendarEvent.patch(
    {
      path: { calendar_id: calendarId, event_id: p.event_id },
      data: updateData,
    },
    opts
  );
  assertLarkOk(res);

  log.info(`patch: updated event ${p.event_id}`);

  return json({
    event: normalizeEventTimeFields(res.data?.event as Record<string, unknown> | undefined),
  });
}

async function handleDelete(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof deleteActionSchema>>>;
  const { larkClient } = context;

  if (!p.event_id) {
    return jsonError('event_id is required');
  }

  const accessTokenResult = await getToolAccessToken(context);
  if (isToolResult(accessTokenResult)) return accessTokenResult;
  const accessToken = accessTokenResult;

  const calendarId = await resolveCalendarId(p.calendar_id, larkClient!, accessToken);

  log.info(
    `delete: calendar_id=${calendarId}, event_id=${p.event_id}, notify=${p.need_notification ?? true}`
  );

  const opts = await withUserAccessToken(accessToken);

  const res = await larkClient!.sdk.calendar.calendarEvent.delete(
    {
      path: { calendar_id: calendarId, event_id: p.event_id },
      params: {
        need_notification: p.need_notification === false ? 'false' : 'true',
      },
    },
    opts
  );
  assertLarkOk(res);

  log.info(`delete: deleted event ${p.event_id}`);

  return json({
    success: true,
    event_id: p.event_id,
  });
}
