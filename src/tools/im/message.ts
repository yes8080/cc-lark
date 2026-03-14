/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_im_message tool - Send/reply IM messages with user identity.
 *
 * Actions: send, reply
 *
 * Uses Feishu IM API:
 *   - send:  POST /open-apis/im/v1/messages?receive_id_type=...
 *   - reply: POST /open-apis/im/v1/messages/:message_id/reply
 *
 * All calls use user access token (UAT) - requires OAuth authorization.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError, type ToolResult } from './helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:im:message');

// ---------------------------------------------------------------------------
// Input schemas (raw shape for ZodRawShapeCompat)
// ---------------------------------------------------------------------------

const msgTypeEnum = z.enum([
  'text',
  'post',
  'image',
  'file',
  'audio',
  'media',
  'interactive',
  'share_chat',
  'share_user',
]);

// We use separate tools for send and reply to avoid discriminated union issues
const sendMessageSchema = {
  action: z.literal('send').describe('Send a message'),
  receive_id_type: z.enum(['open_id', 'chat_id']).describe(
    'Recipient ID type: open_id (private chat, ou_xxx) or chat_id (group chat, oc_xxx)'
  ),
  receive_id: z.string().describe(
    "Recipient ID corresponding to receive_id_type. Use 'ou_xxx' for open_id, 'oc_xxx' for chat_id"
  ),
  msg_type: msgTypeEnum.describe(
    'Message type: text (plain text), post (rich text), image, file, interactive (card), share_chat (group card), share_user (user card), etc.'
  ),
  content: z.string().describe(
    'Message content (JSON string), format depends on msg_type. ' +
      'Examples: text -> \'{"text":"Hello"}\', ' +
      'image -> \'{"image_key":"img_xxx"}\', ' +
      'share_chat -> \'{"chat_id":"oc_xxx"}\', ' +
      'post -> \'{"zh_cn":{"title":"Title","content":[[{"tag":"text","text":"Body"}]]}}\''
  ),
  uuid: z.string().optional().describe(
    'Idempotent unique identifier. Same uuid will only send one message within 1 hour for deduplication.'
  ),
};

const replyMessageSchema = {
  action: z.literal('reply').describe('Reply to a message'),
  message_id: z.string().describe('Message ID to reply to (om_xxx format)'),
  msg_type: msgTypeEnum.describe(
    'Message type: text (plain text), post (rich text), image, interactive (card), etc.'
  ),
  content: z.string().describe('Reply message content (JSON string), same format as send content'),
  reply_in_thread: z.boolean().optional().describe(
    'Whether to reply in thread. true = message appears in the thread, false (default) = appears in main chat flow'
  ),
  uuid: z.string().optional().describe('Idempotent unique identifier'),
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register the feishu_im_message tool for sending messages.
 */
export function registerImMessageTool(registry: ToolRegistry): void {
  // Register send message tool
  registry.register({
    name: 'feishu_im_send_message',
    description: [
      'Send an IM message with user identity.',
      '',
      'Usage:',
      '- Use receive_id_type=open_id for private chat (provide user open_id)',
      '- Use receive_id_type=chat_id for group chat (provide chat_id)',
      '',
      'Message types:',
      '- text: Plain text. Content: \'{"text":"message"}\'',
      '- post: Rich text. Content: \'{"zh_cn":{"title":"Title","content":[[{"tag":"text","text":"text"}]]}}\'',
      '- image: Image. Content: \'{"image_key":"img_xxx"}\'',
      '- file: File. Content: \'{"file_key":"file_xxx"}\'',
      '- interactive: Interactive card.',
      '',
      'IMPORTANT: This tool sends messages as the authenticated user.',
      'Before calling, confirm with the user: 1) Who to send to, 2) Message content.',
      '',
      'Requires OAuth authorization (use feishu_oauth tool with action="authorize" first).',
    ].join('\n'),
    inputSchema: sendMessageSchema,
    handler: async (args, context) => {
      return handleSend(args, context);
    },
  });

  // Register reply message tool
  registry.register({
    name: 'feishu_im_reply_message',
    description: [
      'Reply to an IM message with user identity.',
      '',
      'Usage:',
      '- Use message_id (om_xxx) to specify which message to reply to',
      '- Use reply_in_thread=true to create a thread reply',
      '',
      'Message types:',
      '- text: Plain text. Content: \'{"text":"message"}\'',
      '- post: Rich text. Content: \'{"zh_cn":{"title":"Title","content":[[{"tag":"text","text":"text"}]]}}\'',
      '- image: Image. Content: \'{"image_key":"img_xxx"}\'',
      '',
      'Requires OAuth authorization (use feishu_oauth tool with action="authorize" first).',
    ].join('\n'),
    inputSchema: replyMessageSchema,
    handler: async (args, context) => {
      return handleReply(args, context);
    },
  });

  log.debug('feishu_im_message tools registered');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleSend(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof sendMessageSchema>>>;
  const { larkClient, config } = context;

  if (!larkClient) {
    return jsonError('LarkClient not initialized. Check FEISHU_APP_ID and FEISHU_APP_SECRET.');
  }

  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) {
    return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');
  }

  // Get the first stored user token
  const { listStoredTokens } = await import('../../core/token-store.js');
  const tokens = await listStoredTokens(appId);
  if (tokens.length === 0) {
    return jsonError(
      'No user authorization found. Please use the feishu_oauth tool with action="authorize" to authorize a user first.'
    );
  }

  const userOpenId = tokens[0].userOpenId;

  try {
    const accessToken = await getValidAccessToken({
      userOpenId,
      appId,
      appSecret,
      domain: brand ?? 'feishu',
    });

    log.info('Sending message', {
      receive_id_type: p.receive_id_type,
      receive_id: p.receive_id,
      msg_type: p.msg_type,
    });

    const Lark = await import('@larksuiteoapi/node-sdk');
    const opts = Lark.withUserAccessToken(accessToken);

    const res = await larkClient.sdk.im.v1.message.create(
      {
        params: { receive_id_type: p.receive_id_type },
        data: {
          receive_id: p.receive_id,
          msg_type: p.msg_type,
          content: p.content,
          uuid: p.uuid,
        },
      },
      opts
    );

    assertLarkOk(res);

    const data = res.data as Record<string, unknown> | undefined;
    log.info('Message sent', { message_id: data?.message_id });

    return json({
      message_id: data?.message_id,
      chat_id: data?.chat_id,
      create_time: data?.create_time,
    });
  } catch (err) {
    if (err instanceof NeedAuthorizationError) {
      return jsonError(
        `User authorization required or expired. Please use feishu_oauth tool with action="authorize" to re-authorize.`,
        { userOpenId }
      );
    }
    log.error('Send message failed', { error: err instanceof Error ? err.message : String(err) });
    return jsonError(err instanceof Error ? err.message : String(err));
  }
}

async function handleReply(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as z.infer<ReturnType<typeof z.object<typeof replyMessageSchema>>>;
  const { larkClient, config } = context;

  if (!larkClient) {
    return jsonError('LarkClient not initialized. Check FEISHU_APP_ID or FEISHU_APP_SECRET.');
  }

  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) {
    return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');
  }

  // Get the first stored user token
  const { listStoredTokens } = await import('../../core/token-store.js');
  const tokens = await listStoredTokens(appId);
  if (tokens.length === 0) {
    return jsonError(
      'No user authorization found. Please use the feishu_oauth tool with action="authorize" to authorize a user first.'
    );
  }

  const userOpenId = tokens[0].userOpenId;

  try {
    const accessToken = await getValidAccessToken({
      userOpenId,
      appId,
      appSecret,
      domain: brand ?? 'feishu',
    });

    log.info('Replying to message', {
      message_id: p.message_id,
      msg_type: p.msg_type,
      reply_in_thread: p.reply_in_thread ?? false,
    });

    const Lark = await import('@larksuiteoapi/node-sdk');
    const opts = Lark.withUserAccessToken(accessToken);

    const res = await larkClient.sdk.im.v1.message.reply(
      {
        path: { message_id: p.message_id },
        data: {
          content: p.content,
          msg_type: p.msg_type,
          reply_in_thread: p.reply_in_thread,
          uuid: p.uuid,
        },
      },
      opts
    );

    assertLarkOk(res);

    const data = res.data as Record<string, unknown> | undefined;
    log.info('Reply sent', { message_id: data?.message_id });

    return json({
      message_id: data?.message_id,
      chat_id: data?.chat_id,
      create_time: data?.create_time,
    });
  } catch (err) {
    if (err instanceof NeedAuthorizationError) {
      return jsonError(
        `User authorization required or expired. Please use feishu_oauth tool with action="authorize" to re-authorize.`,
        { userOpenId }
      );
    }
    log.error('Reply message failed', { error: err instanceof Error ? err.message : String(err) });
    return jsonError(err instanceof Error ? err.message : String(err));
  }
}
