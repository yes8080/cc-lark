/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * OAuth tool for Feishu/Lark user authorization.
 *
 * Provides MCP tool for OAuth 2.0 Device Authorization Grant flow.
 * Supports 'authorize' and 'revoke' actions.
 */

import { z } from 'zod';
import type { ToolRegistry } from './index.js';
import {
  requestDeviceAuthorization,
  pollDeviceToken,
  type DeviceAuthResponse,
} from '../core/device-flow.js';
import { getStoredToken, listStoredTokens, tokenStatus } from '../core/token-store.js';
import { getUATStatus, saveTokenFromDeviceFlow, revokeUAT } from '../core/uat-client.js';
import { logger } from '../utils/logger.js';

const log = logger('tools:oauth');

// ---------------------------------------------------------------------------
// Input schema (raw shape for ZodRawShapeCompat)
// ---------------------------------------------------------------------------

const OAuthInputSchema = {
  action: z
    .enum(['authorize', 'authorize_poll', 'revoke', 'status'])
    .describe(
      'The OAuth action to perform: "authorize" starts device flow and returns verification URL (user must visit it), "authorize_poll" polls for completion after user authorizes, "revoke" removes stored token, "status" checks authorization status'
    ),
  scope: z
    .string()
    .optional()
    .describe(
      'Space-separated list of OAuth scopes to request (e.g., "contact:user.base:readonly mail:mail:readonly"). Used with "authorize" action.'
    ),
  user_open_id: z
    .string()
    .optional()
    .describe(
      'The user open_id for "revoke" or "status" action. For "authorize", this will be discovered automatically.'
    ),
  device_code: z
    .string()
    .optional()
    .describe(
      'Device code returned by a previous "authorize" call. Required for "authorize_poll" action.'
    ),
  interval: z
    .number()
    .optional()
    .describe(
      'Polling interval in seconds, returned by "authorize". Used with "authorize_poll" (default: 5).'
    ),
  expires_in: z
    .number()
    .optional()
    .describe(
      'Device code TTL in seconds, returned by "authorize". Used with "authorize_poll" (default: 240).'
    ),
};

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

interface OAuthResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Handle 'authorize' action - start OAuth device flow.
 *
 * Returns the verification URL immediately so the AI agent can show it to
 * the user. The caller must follow up with `authorize_poll` to complete
 * the flow after the user has visited the URL.
 */
async function handleAuthorize(
  scope: string | undefined,
  appId: string,
  appSecret: string,
  brand: string
): Promise<OAuthResult> {
  log.info('Starting device authorization flow', { scope: scope || 'default' });

  const requestedScope = scope || 'contact:user.base:readonly';

  try {
    let deviceAuth: DeviceAuthResponse;
    try {
      deviceAuth = await requestDeviceAuthorization({
        appId,
        appSecret,
        brand: brand as 'feishu' | 'lark',
        scope: requestedScope,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Device authorization request failed', { error: message });
      return {
        content: [
          {
            type: 'text',
            text: `Failed to start OAuth flow: ${message}\n\nPlease check:\n1. Your FEISHU_APP_ID and FEISHU_APP_SECRET are correct\n2. The app is properly configured in the Developer Console`,
          },
        ],
        isError: true,
      };
    }

    log.info('Device code obtained', {
      userCode: deviceAuth.userCode,
      verificationUri: deviceAuth.verificationUri,
      expiresIn: deviceAuth.expiresIn,
    });

    // Return the verification URL immediately — do NOT block on polling.
    // The AI agent should show this to the user, then call authorize_poll.
    return {
      content: [
        {
          type: 'text',
          text: [
            'Please ask the user to authorize by visiting this URL:',
            '',
            deviceAuth.verificationUriComplete,
            '',
            `Verification code: ${deviceAuth.userCode}`,
            `Expires in ${Math.floor(deviceAuth.expiresIn / 60)} minutes.`,
            '',
            'After the user completes authorization, call feishu_oauth again with:',
            '  action: "authorize_poll"',
            `  device_code: "${deviceAuth.deviceCode}"`,
            `  interval: ${deviceAuth.interval}`,
            `  expires_in: ${deviceAuth.expiresIn}`,
          ].join('\n'),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('OAuth authorization failed', { error: message });
    return {
      content: [
        {
          type: 'text',
          text: `Authorization failed: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle 'authorize_poll' action - poll for device flow completion.
 *
 * Called after the user has been shown the verification URL via `authorize`.
 * Blocks until the user authorizes, denies, or the device code expires.
 */
async function handleAuthorizePoll(
  deviceCode: string | undefined,
  interval: number | undefined,
  expiresIn: number | undefined,
  appId: string,
  appSecret: string,
  brand: string
): Promise<OAuthResult> {
  if (!deviceCode) {
    return {
      content: [
        {
          type: 'text',
          text: 'device_code is required for authorize_poll. Call "authorize" first to obtain one.',
        },
      ],
      isError: true,
    };
  }

  log.info('Polling for device authorization', { interval, expiresIn });

  const result = await pollDeviceToken({
    appId,
    appSecret,
    brand: brand as 'feishu' | 'lark',
    deviceCode,
    interval: interval ?? 5,
    expiresIn: expiresIn ?? 240,
  });

  if (!result.ok) {
    log.warn('OAuth poll failed', { error: result.error, message: result.message });
    return {
      content: [
        {
          type: 'text',
          text: `Authorization failed: ${result.message}`,
        },
      ],
      isError: true,
    };
  }

  // Token obtained — resolve user identity and persist.
  const { token } = result;
  let userOpenId: string;
  try {
    const userinfoUrl =
      brand === 'lark'
        ? 'https://open.larksuite.com/open-apis/authen/v1/user_info'
        : 'https://open.feishu.cn/open-apis/authen/v1/user_info';

    const userinfoResp = await fetch(userinfoUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    const userinfoData = (await userinfoResp.json()) as {
      code?: number;
      data?: { user?: { open_id?: string } };
      msg?: string;
    };

    if (userinfoData.code !== 0 || !userinfoData.data?.user?.open_id) {
      log.warn('Could not fetch user info from API', {
        code: userinfoData.code,
        msg: userinfoData.msg,
      });
      userOpenId = 'unknown';
    } else {
      userOpenId = userinfoData.data.user.open_id;
      log.info('Got user open_id from userinfo API', { userOpenId });
    }
  } catch (err) {
    log.warn('Failed to fetch user info', {
      error: err instanceof Error ? err.message : String(err),
    });
    userOpenId = 'unknown';
  }

  await saveTokenFromDeviceFlow(
    { appId, appSecret, userOpenId, domain: brand as 'feishu' | 'lark' },
    {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      refreshExpiresIn: token.refreshExpiresIn,
      scope: token.scope,
    }
  );

  log.info('OAuth authorization successful', { userOpenId, scope: token.scope });

  return {
    content: [
      {
        type: 'text',
        text: [
          'Authorization successful!',
          '',
          `User Open ID: ${userOpenId}`,
          `Scope: ${token.scope}`,
          `Expires in: ${Math.floor(token.expiresIn / 3600)} hours`,
          '',
          'You can now use user-authorized APIs.',
        ].join('\n'),
      },
    ],
  };
}

/**
 * Handle 'revoke' action - remove stored token.
 */
async function handleRevoke(userOpenId: string | undefined, appId: string): Promise<OAuthResult> {
  if (!userOpenId) {
    // List all stored tokens for this app
    const tokens = await listStoredTokens(appId);
    if (tokens.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No stored authorizations found.',
          },
        ],
      };
    }

    const tokenList = tokens
      .map((t) => `- ${t.userOpenId} (scope: ${t.scope || 'unknown'})`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: [
            'Stored authorizations:',
            tokenList,
            '',
            'To revoke, specify the user_open_id parameter.',
          ].join('\n'),
        },
      ],
    };
  }

  log.info('Revoking authorization', { userOpenId });

  // Check if token exists
  const token = await getStoredToken(appId, userOpenId);
  if (!token) {
    return {
      content: [
        {
          type: 'text',
          text: `No authorization found for user_open_id: ${userOpenId}`,
        },
      ],
      isError: true,
    };
  }

  // Remove the token
  await revokeUAT(appId, userOpenId);

  return {
    content: [
      {
        type: 'text',
        text: `Authorization revoked for user: ${userOpenId}`,
      },
    ],
  };
}

/**
 * Handle 'status' action - check authorization status.
 */
async function handleStatus(
  userOpenId: string | undefined,
  appId: string,
  appSecret: string,
  brand: string
): Promise<OAuthResult> {
  if (!userOpenId) {
    // List all stored tokens for this app
    const tokens = await listStoredTokens(appId);
    if (tokens.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No stored authorizations found. Use the "authorize" action to start OAuth.',
          },
        ],
      };
    }

    const tokenList = tokens
      .map((t) => {
        const status = tokenStatus(t);
        const statusEmoji =
          status === 'valid' ? 'valid' : status === 'needs_refresh' ? 'expiring' : 'expired';
        const expiresDate = new Date(t.expiresAt).toISOString();
        return `- ${t.userOpenId}\n  Status: ${statusEmoji}\n  Scope: ${t.scope || 'unknown'}\n  Expires: ${expiresDate}`;
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: ['Stored authorizations:', '', tokenList].join('\n'),
        },
      ],
    };
  }

  log.info('Checking authorization status', { userOpenId });

  const status = await getUATStatus({
    userOpenId,
    appId,
    appSecret,
    domain: brand as 'feishu' | 'lark',
  });

  if (!status.authorized) {
    return {
      content: [
        {
          type: 'text',
          text: `No valid authorization for user: ${userOpenId}\n\nUse the "authorize" action to start OAuth.`,
        },
      ],
      isError: true,
    };
  }

  const expiresDate = status.expiresAt ? new Date(status.expiresAt).toISOString() : 'unknown';
  const refreshExpiresDate = status.refreshExpiresAt
    ? new Date(status.refreshExpiresAt).toISOString()
    : 'unknown';
  const grantedDate = status.grantedAt ? new Date(status.grantedAt).toISOString() : 'unknown';

  return {
    content: [
      {
        type: 'text',
        text: [
          `Authorization status for user: ${userOpenId}`,
          '',
          `Status: ${status.tokenStatus}`,
          `Scope: ${status.scope || 'unknown'}`,
          `Expires: ${expiresDate}`,
          `Refresh expires: ${refreshExpiresDate}`,
          `Granted: ${grantedDate}`,
        ].join('\n'),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register the OAuth tool with the registry.
 */
export function registerOAuthTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_oauth',
    description: [
      'Manage OAuth authorization for Feishu/Lark user access tokens.',
      '',
      'Authorization is a two-step process:',
      '  1. Call with action="authorize" → returns a verification URL. Show this URL to the user.',
      '  2. After the user visits the URL, call with action="authorize_poll" + device_code/interval/expires_in from step 1.',
      '',
      'Actions:',
      '- authorize: Start device flow, returns verification URL immediately (does NOT block).',
      '- authorize_poll: Poll for completion. Requires device_code, interval, expires_in from authorize response.',
      '- revoke: Remove stored authorization. If no user_open_id, lists all.',
      '- status: Check authorization status. If no user_open_id, lists all.',
      '',
      'Scopes (for authorize action):',
      '- contact:user.base:readonly - Basic user info',
      '- mail:mail:readonly - Read mail',
      '- mail:mail - Read and send mail',
      '- docs:doc:readonly - Read documents',
      '- docs:doc - Read and edit documents',
      '- sheets:spreadsheet - Access spreadsheets',
      '- drive:drive - Access drive files',
      '',
      'Example scopes: "contact:user.base:readonly mail:mail:readonly"',
    ].join('\n'),
    inputSchema: OAuthInputSchema,
    handler: async (args, context) => {
      const { action, scope, user_open_id, device_code, interval, expires_in } = args;
      const { config } = context;
      const { appId, appSecret, brand } = config;

      if (!appId || !appSecret) {
        return {
          content: [
            {
              type: 'text',
              text: 'OAuth requires FEISHU_APP_ID and FEISHU_APP_SECRET environment variables to be set.',
            },
          ],
          isError: true,
        };
      }

      switch (action) {
        case 'authorize':
          return handleAuthorize(scope, appId, appSecret, brand ?? 'feishu');

        case 'authorize_poll':
          return handleAuthorizePoll(
            device_code,
            interval,
            expires_in,
            appId,
            appSecret,
            brand ?? 'feishu'
          );

        case 'revoke':
          return handleRevoke(user_open_id, appId);

        case 'status':
          return handleStatus(user_open_id, appId, appSecret, brand ?? 'feishu');

        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action: ${action}. Supported actions: authorize, authorize_poll, revoke, status.`,
              },
            ],
            isError: true,
          };
      }
    },
  });

  log.debug('OAuth tool registered');
}
