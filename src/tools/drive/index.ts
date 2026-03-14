/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Drive Tools Index
 *
 * Drive/file management tools for Feishu/Lark.
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import type { ToolRegistry } from '../index.js';
import { registerDriveFileTool } from './file.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:drive');

export function registerDriveTools(registry: ToolRegistry): void {
  registerDriveFileTool(registry);

  log.info('Drive tools registered', {
    tools: [
      'feishu_drive_file_list',
      'feishu_drive_file_get_meta',
      'feishu_drive_file_copy',
      'feishu_drive_file_move',
      'feishu_drive_file_delete',
    ].join(', '),
  });
}
