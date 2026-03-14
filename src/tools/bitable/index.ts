/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Bitable Tools Index
 *
 * Bitable (multidimensional table) tools for Feishu/Lark.
 * Adapted from openclaw-lark for MCP Server architecture.
 *
 * Tools:
 * - feishu_bitable_app: Manage Bitable apps
 * - feishu_bitable_table: Manage tables within a Bitable
 * - feishu_bitable_record: Manage records within a table
 * - feishu_bitable_field: Manage fields within a table
 */

import type { ToolRegistry } from '../index.js';
import { registerBitableAppTool } from './app.js';
import { registerBitableTableTool } from './table.js';
import { registerBitableRecordTool } from './record.js';
import { registerBitableFieldTool } from './field.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:bitable');

/**
 * Register all Bitable tools with the given registry.
 */
export function registerBitableTools(registry: ToolRegistry): void {
  registerBitableAppTool(registry);
  registerBitableTableTool(registry);
  registerBitableRecordTool(registry);
  registerBitableFieldTool(registry);

  log.info('Bitable tools registered', {
    tools: [
      'feishu_bitable_app',
      'feishu_bitable_table',
      'feishu_bitable_record',
      'feishu_bitable_field',
    ].join(', '),
  });
}
