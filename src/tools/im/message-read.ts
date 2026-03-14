/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * IM message read tools - Get/search Feishu messages with user identity.
 *
 * Tools:
 *   - feishu_im_get_messages: Get chat/thread messages
 *   - feishu_im_get_thread_messages: Get thread messages
 *   - feishu_im_search_messages: Search messages across chats
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError, getCachedUserName, setCachedUserNames, type ToolResult } from './helpers.js';
import { parseTimeRangeToSeconds, dateTimeToSecondsString, millisStringToDateTime } from './time-utils.js';
import {
  formatMessageList,
  type FormattedMessage,
  type ApiMessageItem,
  extractMentionOpenId,
} from './format-messages.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:im:message-read');

// ---------------------------------------------------------------------------
// Shared schema components (raw shapes for ZodRawShapeCompat)
// ---------------------------------------------------------------------------

const sortRuleShape = {
  sort_rule: z
    .enum(['create_time_asc', 'create_time_desc'])
    .optional()
    .describe('Sort order: create_time_asc (oldest first) or create_time_desc (newest first, default)'),
};

const paginationShape = {
  page_size: z.number().min(1).max(50).optional().describe('Number of results per page (1-50), default 50'),
  page_token: z.string().optional().describe('Pagination token for next page'),
};

const timeRangeShape = {
  relative_time: z
    .string()
    .optional()
    .describe(
      'Relative time range: today / yesterday / day_before_yesterday / this_week / last_week / this_month / last_month / last_{N}_{unit} (unit: minutes/hours/days). Mutually exclusive with start_time/end_time.'
    ),
  start_time: z
    .string()
    .optional()
    .describe('Start time (ISO 8601 format, e.g., 2026-02-27T00:00:00+08:00). Mutually exclusive with relative_time.'),
  end_time: z
    .string()
    .optional()
    .describe('End time (ISO 8601 format, e.g., 2026-02-27T23:59:59+08:00). Mutually exclusive with relative_time.'),
};

// ---------------------------------------------------------------------------
// feishu_im_get_messages
// ---------------------------------------------------------------------------

const getMessagesShape = {
  open_id: z
    .string()
    .optional()
    .describe('User open_id (ou_xxx) to get 1-on-1 chat messages. Mutually exclusive with chat_id.'),
  chat_id: z
    .string()
    .optional()
    .describe('Chat ID (oc_xxx) to get group or 1-on-1 chat messages. Mutually exclusive with open_id.'),
  ...sortRuleShape,
  ...paginationShape,
  ...timeRangeShape,
};

// ---------------------------------------------------------------------------
// feishu_im_get_thread_messages
// ---------------------------------------------------------------------------

const getThreadMessagesShape = {
  thread_id: z.string().describe('Thread ID (omt_xxx format)'),
  ...sortRuleShape,
  ...paginationShape,
};

// ---------------------------------------------------------------------------
// feishu_im_search_messages
// ---------------------------------------------------------------------------

const searchMessagesShape = {
  query: z
    .string()
    .optional()
    .describe('Search keyword to match message content. Can be empty string for no content filter.'),
  sender_ids: z
    .array(z.string())
    .optional()
    .describe("Sender open_id list (ou_xxx). Use search_user tool to find open_id by name if needed."),
  chat_id: z.string().optional().describe('Chat ID (oc_xxx) to limit search scope'),
  mention_ids: z.array(z.string()).optional().describe('Mentioned user open_id list (ou_xxx)'),
  message_type: z
    .enum(['file', 'image', 'media'])
    .optional()
    .describe('Message type filter: file / image / media. Empty for all types.'),
  sender_type: z.enum(['user', 'bot', 'all']).optional().describe('Sender type: user / bot / all. Default user.'),
  chat_type: z.enum(['group', 'p2p']).optional().describe('Chat type: group (group chat) / p2p (private chat)'),
  ...timeRangeShape,
  ...paginationShape,
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function sortRuleToSortType(rule?: 'create_time_asc' | 'create_time_desc'): 'ByCreateTimeAsc' | 'ByCreateTimeDesc' {
  return rule === 'create_time_asc' ? 'ByCreateTimeAsc' : 'ByCreateTimeDesc';
}

function resolveTimeRange(
  p: { relative_time?: string; start_time?: string; end_time?: string },
  logInfo: (msg: string) => void
): { start?: string; end?: string } {
  if (p.relative_time) {
    const range = parseTimeRangeToSeconds(p.relative_time);
    logInfo(`relative_time="${p.relative_time}" -> start=${range.start}, end=${range.end}`);
    return range;
  }
  return {
    start: p.start_time ? dateTimeToSecondsString(p.start_time) : undefined,
    end: p.end_time ? dateTimeToSecondsString(p.end_time) : undefined,
  };
}

type AuthResult = { accessToken: string; userOpenId: string };

/**
 * Get authorization and access token for handlers.
 */
async function getAuth(
  config: import('../../core/types.js').FeishuConfig
): Promise<AuthResult | ToolResult> {
  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) {
    return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');
  }

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
    return { accessToken, userOpenId };
  } catch (err) {
    if (err instanceof NeedAuthorizationError) {
      return jsonError(
        `User authorization required or expired. Please use feishu_oauth tool with action="authorize" to re-authorize.`,
        { userOpenId }
      );
    }
    throw err;
  }
}

function isAuthResult(result: AuthResult | ToolResult): result is AuthResult {
  return 'accessToken' in result;
}

/**
 * Resolve P2P chat_id from open_id.
 */
async function resolveP2PChatId(
  sdk: LarkClient['sdk'],
  openId: string,
  accessToken: string,
  logInfo: (msg: string) => void
): Promise<string> {
  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  const res = await sdk.request<{
    code?: number;
    msg?: string;
    data?: { p2p_chats?: Array<{ chat_id: string }> };
  }>({
    method: 'POST',
    url: '/open-apis/im/v1/chat_p2p/batch_query?user_id_type=open_id',
    data: { chatter_ids: [openId] },
  }, opts);

  const chats = res.data?.p2p_chats;
  if (!chats?.length) {
    logInfo(`batch_query: no p2p chat found for open_id=${openId}`);
    throw new Error(`No 1-on-1 chat found with open_id=${openId}. You may not have chat history with this user.`);
  }

  logInfo(`batch_query: resolved chat_id=${chats[0].chat_id}`);
  return chats[0].chat_id;
}

/**
 * Batch resolve user names via API.
 */
async function batchResolveUserNames(
  sdk: LarkClient['sdk'],
  openIds: string[],
  accessToken: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (openIds.length === 0) return result;

  // Check cache first
  const missing: string[] = [];
  for (const id of openIds) {
    const cached = getCachedUserName(id);
    if (cached) {
      result.set(id, cached);
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) return result;

  // Batch query (50 at a time)
  const BATCH_SIZE = 50;
  const Lark = await import('@larksuiteoapi/node-sdk');
  const opts = Lark.withUserAccessToken(accessToken);

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const chunk = missing.slice(i, i + BATCH_SIZE);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('user_id_type', 'open_id');
      chunk.forEach((id) => queryParams.append('user_ids', id));

      const res = await sdk.request<{
        code?: number;
        data?: { items?: Array<{ open_id?: string; name?: string; display_name?: string; nickname?: string; en_name?: string }> };
      }>({
        method: 'GET',
        url: `/open-apis/contact/v3/users/batch_get?${queryParams.toString()}`,
      }, opts);

      if (res.code === 0 && res.data?.items) {
        for (const item of res.data.items) {
          const openId = item.open_id;
          const name = item.name || item.display_name || item.nickname || item.en_name;
          if (openId && name) {
            result.set(openId, name);
          }
        }
      }
    } catch (err) {
      log.warn('Failed to batch resolve user names', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Cache the results
  if (result.size > 0) {
    setCachedUserNames(result);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register all IM message read tools.
 */
export function registerImMessageReadTools(registry: ToolRegistry): void {
  registerGetMessages(registry);
  registerGetThreadMessages(registry);
  registerSearchMessages(registry);
  log.debug('IM message read tools registered');
}

function registerGetMessages(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_im_get_messages',
    description: [
      'Get chat history messages with user identity.',
      '',
      'Usage:',
      '- Use chat_id to get group/private chat messages',
      '- Use open_id to get 1-on-1 chat messages with a specific user (auto-resolves chat_id)',
      '- Supports time range filter: relative_time (e.g., today, last_3_days) or start_time/end_time (ISO 8601)',
      '- Supports pagination: page_size + page_token',
      '',
      'Constraints:',
      '- Must provide either open_id or chat_id (not both)',
      '- relative_time and start_time/end_time are mutually exclusive',
      '- page_size range 1-50, default 50',
      '',
      'Returns message list with message_id, msg_type, content (AI-readable text), sender, create_time, etc.',
      '',
      'Requires OAuth authorization (use feishu_oauth tool with action="authorize" first).',
    ].join('\n'),
    inputSchema: getMessagesShape,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof getMessagesShape>>>;

      if (!context.larkClient) {
        return jsonError('LarkClient not initialized. Check FEISHU_APP_ID and FEISHU_APP_SECRET.');
      }

      // Validate parameters
      if (p.open_id && p.chat_id) {
        return jsonError('Cannot provide both open_id and chat_id, please provide only one');
      }
      if (!p.open_id && !p.chat_id) {
        return jsonError('Either open_id or chat_id is required');
      }
      if (p.relative_time && (p.start_time || p.end_time)) {
        return jsonError('Cannot use both relative_time and start_time/end_time');
      }

      const authResult = await getAuth(context.config);
      if (!isAuthResult(authResult)) return authResult;
      const { accessToken } = authResult;

      const logInfo = (msg: string) => log.info(msg);

      let chatId = p.chat_id ?? '';
      if (p.open_id) {
        logInfo(`Resolving P2P chat for open_id=${p.open_id}`);
        chatId = await resolveP2PChatId(context.larkClient.sdk, p.open_id, accessToken, logInfo);
      }

      const time = resolveTimeRange(p, logInfo);
      logInfo(`list: chat_id=${chatId}, sort=${p.sort_rule ?? 'create_time_desc'}, page_size=${p.page_size ?? 50}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await context.larkClient.sdk.im.v1.message.list(
        {
          params: {
            container_id_type: 'chat',
            container_id: chatId,
            start_time: time.start,
            end_time: time.end,
            sort_type: sortRuleToSortType(p.sort_rule),
            page_size: p.page_size ?? 50,
            page_token: p.page_token,
            card_msg_content_type: 'raw_card_content',
          } as any,
        },
        opts
      );

      assertLarkOk(res);

      const items = (res.data?.items ?? []) as ApiMessageItem[];
      const nameResolver = (id: string) => getCachedUserName(id);
      const batchResolver = async (ids: string[]) => {
        await batchResolveUserNames(context.larkClient!.sdk, ids, accessToken);
      };

      const messages = await formatMessageList(items, 'default', nameResolver, batchResolver);
      const hasMore = res.data?.has_more ?? false;
      const pageToken = res.data?.page_token;

      logInfo(`list: returned ${messages.length} messages, has_more=${hasMore}`);

      return json({ messages, has_more: hasMore, page_token: pageToken });
    },
  });
}

function registerGetThreadMessages(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_im_get_thread_messages',
    description: [
      'Get messages in a thread with user identity.',
      '',
      'Usage:',
      '- Use thread_id (omt_xxx) to get all messages in a thread',
      '- Supports pagination: page_size + page_token',
      '',
      'Note: Thread messages do not support time range filtering (Lark API limitation)',
      '',
      'Returns message list in the same format as feishu_im_get_messages.',
      '',
      'Requires OAuth authorization (use feishu_oauth tool with action="authorize" first).',
    ].join('\n'),
    inputSchema: getThreadMessagesShape,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof getThreadMessagesShape>>>;

      if (!context.larkClient) {
        return jsonError('LarkClient not initialized. Check FEISHU_APP_ID and FEISHU_APP_SECRET.');
      }

      const authResult = await getAuth(context.config);
      if (!isAuthResult(authResult)) return authResult;
      const { accessToken } = authResult;

      log.info(`list: thread_id=${p.thread_id}, sort=${p.sort_rule ?? 'create_time_desc'}, page_size=${p.page_size ?? 50}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await context.larkClient.sdk.im.v1.message.list(
        {
          params: {
            container_id_type: 'thread',
            container_id: p.thread_id,
            sort_type: sortRuleToSortType(p.sort_rule),
            page_size: p.page_size ?? 50,
            page_token: p.page_token,
            card_msg_content_type: 'raw_card_content',
          } as any,
        },
        opts
      );

      assertLarkOk(res);

      const items = (res.data?.items ?? []) as ApiMessageItem[];
      const nameResolver = (id: string) => getCachedUserName(id);
      const batchResolver = async (ids: string[]) => {
        await batchResolveUserNames(context.larkClient!.sdk, ids, accessToken);
      };

      const messages = await formatMessageList(items, 'default', nameResolver, batchResolver);
      const hasMore = res.data?.has_more ?? false;
      const pageToken = res.data?.page_token;

      log.info(`list: returned ${messages.length} messages, has_more=${hasMore}`);

      return json({ messages, has_more: hasMore, page_token: pageToken });
    },
  });
}

function registerSearchMessages(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_im_search_messages',
    description: [
      'Search messages across chats with user identity.',
      '',
      'Usage:',
      '- Search by keyword in message content',
      '- Filter by sender, mentioned users, message type',
      '- Filter by time range: relative_time or start_time/end_time',
      '- Limit search to a specific chat (chat_id)',
      '- Supports pagination: page_size + page_token',
      '',
      'Constraints:',
      '- All parameters are optional but at least one filter should be provided',
      '- relative_time and start_time/end_time are mutually exclusive',
      '- page_size range 1-50, default 50',
      '',
      'Returns message list with chat_id, chat_type (p2p/group), chat_name.',
      'For p2p chats, includes chat_partner with open_id and name.',
      'Use chat_id and thread_id from results with feishu_im_get_messages / feishu_im_get_thread_messages for context.',
      '',
      'Requires OAuth authorization (use feishu_oauth tool with action="authorize" first).',
    ].join('\n'),
    inputSchema: searchMessagesShape,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof searchMessagesShape>>>;

      if (!context.larkClient) {
        return jsonError('LarkClient not initialized. Check FEISHU_APP_ID and FEISHU_APP_SECRET.');
      }

      if (p.relative_time && (p.start_time || p.end_time)) {
        return jsonError('Cannot use both relative_time and start_time/end_time');
      }

      const authResult = await getAuth(context.config);
      if (!isAuthResult(authResult)) return authResult;
      const { accessToken } = authResult;

      const logInfo = (msg: string) => log.info(msg);

      // Resolve time range
      const time = resolveTimeRange(p, logInfo);
      const searchData: Record<string, unknown> = {
        query: p.query ?? '',
        start_time: time.start ?? '978307200', // Default to 2001-01-01
        end_time: time.end ?? Math.floor(Date.now() / 1000).toString(),
      };
      if (p.sender_ids?.length) searchData.from_ids = p.sender_ids;
      if (p.chat_id) searchData.chat_ids = [p.chat_id];
      if (p.mention_ids?.length) searchData.at_chatter_ids = p.mention_ids;
      if (p.message_type) searchData.message_type = p.message_type;
      if (p.sender_type && p.sender_type !== 'all') searchData.from_type = p.sender_type;
      if (p.chat_type) searchData.chat_type = p.chat_type === 'group' ? 'group_chat' : 'p2p_chat';

      logInfo(`search: query="${p.query ?? ''}", page_size=${p.page_size ?? 50}`);

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      // Step 1: Search for message IDs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchRes = await (context.larkClient.sdk as any).search.message.create(
        {
          data: searchData,
          params: {
            user_id_type: 'open_id',
            page_size: p.page_size ?? 50,
            page_token: p.page_token,
          },
        },
        opts
      );

      assertLarkOk(searchRes);

      const messageIds: string[] = searchRes.data?.items ?? [];
      const hasMore = searchRes.data?.has_more ?? false;
      const pageToken = searchRes.data?.page_token;
      logInfo(`search: found ${messageIds.length} IDs, has_more=${hasMore}`);

      if (messageIds.length === 0) {
        return json({ messages: [], has_more: hasMore, page_token: pageToken });
      }

      // Step 2: Batch get message details
      const queryStr = messageIds.map((id) => `message_ids=${encodeURIComponent(id)}`).join('&');
      const mgetRes = await context.larkClient.sdk.request<{
        code?: number;
        msg?: string;
        data?: { items?: ApiMessageItem[] };
      }>({
        method: 'GET',
        url: `/open-apis/im/v1/messages/mget?${queryStr}&user_id_type=open_id&card_msg_content_type=raw_card_content`,
      }, opts);

      const items = mgetRes.data?.items ?? [];
      logInfo(`mget: ${items.length} details`);

      // Step 3: Batch get chat info
      const chatIds = [...new Set(items.map((i) => i.chat_id).filter(Boolean))] as string[];
      const chatMap = await fetchChatContexts(context.larkClient.sdk, accessToken, chatIds, logInfo);

      // Step 4: Format messages
      const nameResolver = (id: string) => getCachedUserName(id);
      const batchResolver = async (ids: string[]) => {
        await batchResolveUserNames(context.larkClient!.sdk, ids, accessToken);
      };
      const messages = await formatMessageList(items, 'default', nameResolver, batchResolver);

      // Step 5: Resolve p2p target names
      const p2pTargetIds = [...new Set([...chatMap.values()].map((c) => c.p2p_target_id).filter(Boolean))] as string[];
      if (p2pTargetIds.length > 0) {
        await batchResolveUserNames(context.larkClient.sdk, p2pTargetIds, accessToken);
      }

      // Step 6: Enrich messages with chat info
      const enrichedMessages = enrichMessages(messages, items, chatMap, nameResolver);

      logInfo(`result: ${enrichedMessages.length} messages, has_more=${hasMore}`);

      return json({ messages: enrichedMessages, has_more: hasMore, page_token: pageToken });
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers for search
// ---------------------------------------------------------------------------

interface ChatContext {
  name: string;
  chat_mode: string;
  p2p_target_id?: string;
}

async function fetchChatContexts(
  sdk: LarkClient['sdk'],
  accessToken: string,
  chatIds: string[],
  logInfo: (msg: string) => void
): Promise<Map<string, ChatContext>> {
  const map = new Map<string, ChatContext>();
  if (chatIds.length === 0) return map;

  try {
    logInfo(`batch_query: requesting ${chatIds.length} chat_ids`);
    const Lark = await import('@larksuiteoapi/node-sdk');
    const opts = Lark.withUserAccessToken(accessToken);

    const res = await sdk.request<{
      code?: number;
      msg?: string;
      data?: {
        items?: Array<{
          chat_id?: string;
          name?: string;
          chat_mode?: string;
          p2p_target_id?: string;
        }>;
      };
    }>({
      method: 'POST',
      url: '/open-apis/im/v1/chats/batch_query?user_id_type=open_id',
      data: { chat_ids: chatIds },
    }, opts);

    logInfo(`batch_query: response code=${res.code}, items=${res.data?.items?.length ?? 0}`);
    if (res.code !== 0) {
      log.warn(`batch_query: API error code=${res.code}, msg=${res.msg}`);
    }
    for (const c of res.data?.items ?? []) {
      if (c.chat_id) {
        map.set(c.chat_id, {
          name: c.name ?? '',
          chat_mode: c.chat_mode ?? '',
          p2p_target_id: c.p2p_target_id,
        });
      }
    }
  } catch (err) {
    logInfo(`batch_query chats failed: ${err}`);
  }
  return map;
}

function enrichMessages(
  messages: FormattedMessage[],
  items: ApiMessageItem[],
  chatMap: Map<string, ChatContext>,
  nameResolver: (openId: string) => string | undefined
): FormattedMessage[] {
  return messages.map((msg, idx) => {
    const chatId = items[idx]?.chat_id;
    const ctx = chatId ? chatMap.get(chatId) : undefined;
    if (!chatId || !ctx) return { ...msg, chat_id: chatId };

    if (ctx.chat_mode === 'p2p' && ctx.p2p_target_id) {
      const name = nameResolver(ctx.p2p_target_id);
      return {
        ...msg,
        chat_id: chatId,
        chat_type: 'p2p' as const,
        chat_name: name || undefined,
        chat_partner: { open_id: ctx.p2p_target_id, name: name || undefined },
      };
    }

    return {
      ...msg,
      chat_id: chatId,
      chat_type: ctx.chat_mode as 'p2p' | 'group',
      chat_name: ctx.name || undefined,
    };
  });
}
