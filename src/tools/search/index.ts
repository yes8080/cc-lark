/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Search Tools Index
 *
 * Search tools for Feishu/Lark.
 */

import type { ToolRegistry } from '../index.js';
import { registerSearchDocWikiTool } from './doc-search.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:search');

export function registerSearchTools(registry: ToolRegistry): void {
  registerSearchDocWikiTool(registry);

  log.info('Search tools registered', {
    tools: ['feishu_search_doc_wiki'].join(', '),
  });
}
