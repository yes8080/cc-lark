/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_get_user tool - Get user information.
 *
 * Actions: get current user or get user by ID
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { json, jsonError, type ToolResult } from '../im/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:common:get-user');

// Schemas
const getUserSchema = {
  user_id: z
    .string()
    .optional()
    .describe('User ID (format: ou_xxx). If not provided, returns current user info'),
  user_id_type: z
    .enum(['open_id', 'union_id', 'user_id'])
    .optional()
    .describe('User ID type (default: open_id)'),
};

async function getAccessToken(context: {
  larkClient: LarkClient | null;
  config: import('../../core/types.js').FeishuConfig;
}): Promise<string | ToolResult> {
  const { larkClient, config } = context;
  if (!larkClient) return jsonError('LarkClient not initialized.');
  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');

  const { listStoredTokens } = await import('../../core/token-store.js');
  const tokens = await listStoredTokens(appId);
  if (tokens.length === 0) return jsonError('No user authorization found.');
  const userOpenId = tokens[0].userOpenId;

  try {
    return await getValidAccessToken({ userOpenId, appId, appSecret, domain: brand ?? 'feishu' });
  } catch (err) {
    if (err instanceof NeedAuthorizationError) return jsonError('User authorization expired.');
    throw err;
  }
}

export function registerGetUserTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_get_user',
    description:
      'Get Feishu user information. Returns current user if user_id not provided.\n\nRequires OAuth authorization.',
    inputSchema: getUserSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof getUserSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getAccessToken(context);
      if (typeof tokenResult === 'object' && 'content' in tokenResult) return tokenResult;
      const accessToken = tokenResult;

      const Lark = await import('@larksuiteoapi/node-sdk');
      const opts = Lark.withUserAccessToken(accessToken);

      // If no user_id provided, get current user info
      if (!p.user_id) {
        log.info('get_user: fetching current user info');

        try {
          const res = await larkClient!.sdk.authen.userInfo.get({}, opts);

          // Check for API error
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((res as any).code !== undefined && (res as any).code !== 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const e = res as any;
            if (e.code === 41050) {
              return jsonError(
                'Permission denied. User visibility scope limits access to this user.'
              );
            }
            return jsonError(`API Error: code=${e.code}, msg=${e.msg}`);
          }

          log.info('get_user: current user fetched successfully');
          return json({ user: res.data });
        } catch (invokeErr) {
          // Handle 41050 error
          if (
            invokeErr &&
            typeof invokeErr === 'object' &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (invokeErr as any).response?.data?.code === 41050
          ) {
            return jsonError(
              'Permission denied. User visibility scope limits access to this user.'
            );
          }
          throw invokeErr;
        }
      }

      // Get specific user info
      log.info(`get_user: fetching user ${p.user_id}`);

      const userIdType = p.user_id_type || 'open_id';

      try {
        const res = await larkClient!.sdk.contact.v3.user.get(
          {
            path: { user_id: p.user_id },
            params: { user_id_type: userIdType as 'open_id' | 'union_id' | 'user_id' },
          },
          opts
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((res as any).code !== undefined && (res as any).code !== 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e = res as any;
          if (e.code === 41050) {
            return jsonError(
              'Permission denied. User visibility scope limits access to this user.'
            );
          }
          return jsonError(`API Error: code=${e.code}, msg=${e.msg}`);
        }

        log.info(`get_user: user ${p.user_id} fetched successfully`);
        return json({ user: res.data?.user });
      } catch (invokeErr) {
        if (
          invokeErr &&
          typeof invokeErr === 'object' &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (invokeErr as any).response?.data?.code === 41050
        ) {
          return jsonError('Permission denied. User visibility scope limits access to this user.');
        }
        throw invokeErr;
      }
    },
  });

  log.debug('feishu_get_user tool registered');
}
