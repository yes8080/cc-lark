/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Sheets Tools Index
 *
 * Spreadsheet tools for Feishu/Lark.
 */

import type { ToolRegistry } from '../index.js';
import { registerSheetTool } from './sheet.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:sheets');

export function registerSheetsTools(registry: ToolRegistry): void {
  registerSheetTool(registry);

  log.info('Sheets tools registered', {
    tools: ['feishu_sheet_info', 'feishu_sheet_read', 'feishu_sheet_write', 'feishu_sheet_append', 'feishu_sheet_create'].join(', '),
  });
}
