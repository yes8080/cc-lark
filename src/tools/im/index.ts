/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * IM Tools Index
 *
 * Instant messaging tools for Feishu/Lark.
 * Adapted from openclaw-lark for MCP Server architecture.
 *
 * Tools:
 * - feishu_im_message: Send/reply to IM messages
 * - feishu_im_get_messages: Get chat history messages
 * - feishu_im_get_thread_messages: Get thread messages
 * - feishu_im_search_messages: Search messages across chats
 * - feishu_im_fetch_resource: Download message attachments
 */

import type { ToolRegistry } from '../index.js';
import { registerImMessageTool } from './message.js';
import { registerImMessageReadTools } from './message-read.js';
import { registerImFetchResourceTool } from './resource.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:im');

// Re-export submodules for external use
export * from './helpers.js';
export * from './time-utils.js';
export * from './format-messages.js';

/**
 * Register all IM tools with the given registry.
 */
export function registerImTools(registry: ToolRegistry): void {
  registerImMessageTool(registry);
  registerImMessageReadTools(registry);
  registerImFetchResourceTool(registry);

  log.info('IM tools registered', {
    tools: [
      'feishu_im_send_message',
      'feishu_im_reply_message',
      'feishu_im_get_messages',
      'feishu_im_get_thread_messages',
      'feishu_im_search_messages',
      'feishu_im_fetch_resource',
    ].join(', '),
  });
}
