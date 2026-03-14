/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Wiki Tools Index
 *
 * Wiki/knowledge base tools for Feishu/Lark.
 */

import type { ToolRegistry } from '../index.js';
import { registerWikiSpaceTool } from './space.js';
import { registerWikiNodeTool } from './node.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:wiki');

export function registerWikiTools(registry: ToolRegistry): void {
  registerWikiSpaceTool(registry);
  registerWikiNodeTool(registry);

  log.info('Wiki tools registered', {
    tools: [
      'feishu_wiki_space_list',
      'feishu_wiki_space_get',
      'feishu_wiki_space_create',
      'feishu_wiki_node_list',
      'feishu_wiki_node_get',
    ].join(', '),
  });
}
