/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Chat Tools Index
 *
 * Chat/group management tools for Feishu/Lark.
 */

import type { ToolRegistry } from '../index.js';
import { registerChatTool } from './chat.js';
import { registerChatMembersTool } from './members.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:chat');

export function registerChatTools(registry: ToolRegistry): void {
  registerChatTool(registry);
  registerChatMembersTool(registry);

  log.info('Chat tools registered', {
    tools: ['feishu_chat_search', 'feishu_chat_get', 'feishu_chat_members'].join(', '),
  });
}
