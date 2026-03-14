/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Task Tools Index
 *
 * Task tools for Feishu/Lark.
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import type { ToolRegistry } from '../index.js';
import { registerTaskTool } from './task.js';
import { registerTasklistTool } from './tasklist.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:task');

export function registerTaskTools(registry: ToolRegistry): void {
  registerTaskTool(registry);
  registerTasklistTool(registry);

  log.info('Task tools registered', {
    tools: [
      'feishu_task_create',
      'feishu_task_get',
      'feishu_task_list',
      'feishu_task_patch',
      'feishu_tasklist_create',
      'feishu_tasklist_get',
      'feishu_tasklist_list',
      'feishu_tasklist_tasks',
    ].join(', '),
  });
}
