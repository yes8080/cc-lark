/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Common Tools Index
 *
 * User-related tools for Feishu/Lark.
 */

import type { ToolRegistry } from '../index.js';
import { registerGetUserTool } from './get-user.js';
import { registerSearchUserTool } from './search-user.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:common');

export function registerCommonTools(registry: ToolRegistry): void {
  registerGetUserTool(registry);
  registerSearchUserTool(registry);

  log.info('Common tools registered', {
    tools: ['feishu_get_user', 'feishu_search_user'].join(', '),
  });
}
