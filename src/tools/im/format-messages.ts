/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Message formatting utilities for IM tools.
 *
 * Converts raw Feishu IM API message objects to AI-readable JSON format.
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { millisStringToDateTime } from './time-utils.js';
import { getCachedUserName, setCachedUserNames } from './helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:im:format-messages');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of a message item returned by the Feishu IM API.
 */
export interface ApiMessageItem {
  message_id?: string;
  msg_type?: string;
  create_time?: string;
  upper_message_id?: string;
  body?: { content?: string };
  sender?: {
    id?: string;
    sender_type?: string;
  };
  mentions?: Array<{
    key: string;
    id: unknown;
    name?: string;
  }>;
  parent_id?: string;
  thread_id?: string;
  deleted?: boolean;
  updated?: boolean;
  chat_id?: string;
}

/**
 * Formatted message structure for AI consumption.
 */
export interface FormattedMessage {
  message_id: string;
  msg_type: string;
  content: string;
  sender: { id: string; sender_type: string; name?: string };
  create_time: string;
  /** Reply message ID (parent_id). Omitted when thread_id exists since thread context is inferable */
  reply_to?: string;
  thread_id?: string;
  mentions?: Array<{ key: string; id: string; name: string }>;
  deleted: boolean;
  updated: boolean;
  chat_id?: string;
  chat_type?: 'p2p' | 'group';
  chat_name?: string;
  chat_partner?: { open_id: string; name?: string };
}

/**
 * Context for message content conversion.
 */
export interface ConvertContext {
  messageId: string;
  accountId?: string;
  resolveUserName?: (openId: string) => string | undefined;
  batchResolveNames?: (openIds: string[]) => Promise<void>;
  fetchSubMessages?: (messageId: string) => Promise<ApiMessageItem[]>;
}

// ---------------------------------------------------------------------------
// Mention extraction
// ---------------------------------------------------------------------------

/** Extract open_id from mention's id field (handles both object and string formats) */
export function extractMentionOpenId(id: unknown): string {
  if (typeof id === 'string') return id;
  if (id != null && typeof id === 'object' && 'open_id' in id) {
    const openId = (id as Record<string, unknown>).open_id;
    return typeof openId === 'string' ? openId : '';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Message content conversion
// ---------------------------------------------------------------------------

/**
 * Convert raw message content to AI-readable text.
 * This is a simplified version - full converter handles all message types.
 */
export function convertMessageContent(
  raw: string,
  msgType: string,
  _ctx: ConvertContext
): string {
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);

    switch (msgType) {
      case 'text':
        return parsed.text || raw;

      case 'post':
      case 'rich_text': {
        // Rich text - extract text from content blocks
        return extractPostContent(parsed);
      }

      case 'image':
        return `[Image: ${parsed.image_key || 'unknown'}]`;

      case 'file':
        return `[File: ${parsed.file_name || parsed.file_key || 'unknown'}]`;

      case 'audio':
        return `[Audio: ${parsed.file_name || parsed.audio_key || 'unknown'}]`;

      case 'media':
        return `[Media: ${parsed.file_name || parsed.media_key || 'unknown'}]`;

      case 'sticker':
        return `[Sticker: ${parsed.file_key || 'unknown'}]`;

      case 'interactive':
        return '[Interactive Card]';

      case 'share_chat':
        return `[Share Chat: ${parsed.chat_id || 'unknown'}]`;

      case 'share_user':
        return `[Share User: ${parsed.user_id || 'unknown'}]`;

      case 'merge_forward':
        return '[Merged Forwarded Messages]';

      default:
        return raw;
    }
  } catch {
    // Not valid JSON, return as-is
    return raw;
  }
}

/**
 * Extract text content from a post/rich_text message.
 */
function extractPostContent(parsed: Record<string, unknown>): string {
  const sections: string[] = [];

  // Handle multi-language content (zh_cn, en_us, etc.)
  for (const lang of ['zh_cn', 'en_us']) {
    const content = parsed[lang] as Record<string, unknown> | undefined;
    if (!content) continue;

    // Title
    if (content.title) {
      sections.push(String(content.title));
    }

    // Content lines
    if (Array.isArray(content.content)) {
      for (const line of content.content) {
        if (Array.isArray(line)) {
          const lineText = extractLineText(line);
          if (lineText) sections.push(lineText);
        }
      }
    }
  }

  return sections.join('\n') || JSON.stringify(parsed);
}

/**
 * Extract text from a rich text line.
 */
function extractLineText(line: unknown[]): string {
  const parts: string[] = [];

  for (const element of line) {
    if (!element || typeof element !== 'object') continue;
    const el = element as Record<string, unknown>;

    if (el.text_run) {
      const tr = el.text_run as Record<string, unknown>;
      if (tr.content) parts.push(String(tr.content));
    } else if (el.mention_run) {
      const mr = el.mention_run as Record<string, unknown>;
      if (mr.text) parts.push(String(mr.text));
    } else if (el.equation_run) {
      const er = el.equation_run as Record<string, unknown>;
      if (er.content) parts.push(`$${er.content}$`);
    } else if (el.text) {
      parts.push(String(el.text));
    }
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

/**
 * Build ConvertContext from a raw API message item.
 */
export function buildConvertContextFromItem(
  item: ApiMessageItem,
  fallbackMessageId: string,
  accountId?: string
): ConvertContext {
  const mentions = new Map<string, { key: string; openId: string; name: string }>();
  const mentionsByOpenId = new Map<string, { key: string; openId: string; name: string }>();

  for (const m of item.mentions ?? []) {
    const openId = extractMentionOpenId(m.id);
    if (!openId) continue;

    const info = {
      key: m.key,
      openId,
      name: m.name ?? '',
    };
    mentions.set(m.key, info);
    mentionsByOpenId.set(openId, info);
  }

  return {
    messageId: item.message_id ?? fallbackMessageId,
    accountId,
    resolveUserName: accountId ? (openId) => getCachedUserName(openId) : undefined,
  };
}

/**
 * Format a single message item.
 */
export async function formatMessageItem(
  item: ApiMessageItem,
  accountId: string,
  nameResolver: (openId: string) => string | undefined,
  ctxOverrides?: Partial<ConvertContext>
): Promise<FormattedMessage> {
  const messageId = item.message_id ?? '';
  const msgType = item.msg_type ?? 'unknown';

  // Convert message content
  let content = '';
  try {
    const rawContent = item.body?.content ?? '';
    if (rawContent) {
      const ctx = {
        ...buildConvertContextFromItem(item, messageId, accountId),
        ...ctxOverrides,
      };
      content = convertMessageContent(rawContent, msgType, ctx);
    }
  } catch (err) {
    log.warn('Content conversion failed, using raw content', {
      messageId,
      msgType,
      error: err instanceof Error ? err.message : String(err),
    });
    content = item.body?.content ?? '';
  }

  // Build sender info
  const senderId = item.sender?.id ?? '';
  const senderType = item.sender?.sender_type ?? 'unknown';
  let senderName: string | undefined;
  if (senderId && senderType === 'user') {
    senderName = nameResolver(senderId);
  }

  const sender: FormattedMessage['sender'] = {
    id: senderId,
    sender_type: senderType,
  };
  if (senderName) {
    sender.name = senderName;
  }

  // Build mentions
  let mentions: FormattedMessage['mentions'];
  if (item.mentions && item.mentions.length > 0) {
    mentions = item.mentions.map((m) => ({
      key: m.key ?? '',
      id: extractMentionOpenId(m.id),
      name: m.name ?? '',
    }));
  }

  // Convert create_time (milliseconds string to ISO 8601 +08:00)
  const createTime = item.create_time ? millisStringToDateTime(item.create_time) : '';

  const formatted: FormattedMessage = {
    message_id: messageId,
    msg_type: msgType,
    content,
    sender,
    create_time: createTime,
    deleted: item.deleted ?? false,
    updated: item.updated ?? false,
  };

  // Optional fields
  // reply_to (parent_id) and thread_id display logic:
  // - If thread_id exists, only show thread_id (omit reply_to, thread context is inferable)
  // - If no thread_id but has parent_id, show as reply_to
  if (item.thread_id) {
    formatted.thread_id = item.thread_id;
  } else if (item.parent_id) {
    formatted.reply_to = item.parent_id;
  }
  if (mentions) {
    formatted.mentions = mentions;
  }
  if (item.chat_id) {
    formatted.chat_id = item.chat_id;
  }

  return formatted;
}

/**
 * Batch format message list.
 *
 * First batch resolves all sender names (writes to cache),
 * then formats each message individually.
 */
export async function formatMessageList(
  items: ApiMessageItem[],
  accountId: string,
  nameResolver: (openId: string) => string | undefined,
  batchResolver: (openIds: string[]) => Promise<void>
): Promise<FormattedMessage[]> {
  // 1. Cache mention names (free info from API)
  const mentionNames = new Map<string, string>();
  for (const item of items) {
    for (const m of item.mentions ?? []) {
      const openId = extractMentionOpenId(m.id);
      if (openId && m.name) {
        mentionNames.set(openId, m.name);
      }
    }
  }
  if (mentionNames.size > 0) {
    setCachedUserNames(mentionNames);
  }

  // 2. Collect all user sender open_ids
  const senderIds = [
    ...new Set(
      items
        .map((item) => (item.sender?.sender_type === 'user' ? item.sender.id : undefined))
        .filter((id): id is string => !!id)
    ),
  ];

  // 3. Batch resolve missing names
  if (senderIds.length > 0) {
    const missing = senderIds.filter((id) => nameResolver(id) === undefined);
    if (missing.length > 0) {
      await batchResolver(missing);
    }
  }

  // 4. Format each message
  const ctxOverrides: Partial<ConvertContext> = {
    accountId,
    resolveUserName: nameResolver,
    batchResolveNames: batchResolver,
  };

  return Promise.all(
    items.map((item) => formatMessageItem(item, accountId, nameResolver, ctxOverrides))
  );
}
