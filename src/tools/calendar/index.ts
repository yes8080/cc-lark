/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Calendar Tools Index
 *
 * Calendar tools for Feishu/Lark.
 * Adapted from openclaw-lark for MCP Server architecture.
 *
 * Tools:
 * - feishu_calendar: Manage calendars (list, get, primary)
 * - feishu_calendar_event: Manage calendar events
 */

import type { ToolRegistry } from '../index.js';
import { registerCalendarTool } from './calendar.js';
import { registerCalendarEventTool } from './event.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:calendar');

/**
 * Register all Calendar tools with the given registry.
 */
export function registerCalendarTools(registry: ToolRegistry): void {
  registerCalendarTool(registry);
  registerCalendarEventTool(registry);

  log.info('Calendar tools registered', {
    tools: [
      'feishu_calendar_list',
      'feishu_calendar_get',
      'feishu_calendar_primary',
      'feishu_calendar_event_create',
      'feishu_calendar_event_list',
      'feishu_calendar_event_get',
      'feishu_calendar_event_patch',
      'feishu_calendar_event_delete',
    ].join(', '),
  });
}
