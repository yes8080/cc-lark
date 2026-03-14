/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Doc Tools Index
 *
 * Document tools for Feishu/Lark.
 * Adapted from openclaw-lark for MCP Server architecture.
 *
 * Tools:
 * - feishu_create_doc: Create new docx document from Markdown
 * - feishu_fetch_doc: Get document content
 * - feishu_update_doc: Update document content
 */

import type { ToolRegistry } from '../index.js';
import { registerCreateDocTool } from './create.js';
import { registerFetchDocTool } from './fetch.js';
import { registerUpdateDocTool } from './update.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:doc');

// Re-export submodules for external use
export * from './shared.js';

/**
 * Register all Doc tools with the given registry.
 */
export function registerDocTools(registry: ToolRegistry): void {
  registerCreateDocTool(registry);
  registerFetchDocTool(registry);
  registerUpdateDocTool(registry);

  log.info('Doc tools registered', {
    tools: ['feishu_create_doc', 'feishu_fetch_doc', 'feishu_update_doc'].join(', '),
  });
}
