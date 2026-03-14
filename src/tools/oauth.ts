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
import {
  getStoredToken,
  listStoredTokens,
  tokenStatus,
} from '../core/token-store.js';
import { getUATStatus, saveTokenFromDeviceFlow, revokeUAT } from '../core/uat-client.js';
import { logger } from '../utils/logger.js';

const log = logger('tools:oauth');

// ---------------------------------------------------------------------------
// Input schema (raw shape for ZodRawShapeCompat)
// ---------------------------------------------------------------------------

const OAuthInputSchema = {
  action: z.enum(['authorize', 'revoke', 'status']).describe(
    'The OAuth action to perform: "authorize" starts device flow, "revoke" removes stored token, "status" checks authorization status'
  ),
  scope: z.string().optional().describe(
    'Space-separated list of OAuth scopes to request (e.g., "contact:user.base:readonly mail:mail:readonly"). Used with "authorize" action.'
  ),
  user_open_id: z.string().optional().describe(
    'The user open_id for "revoke" or "status" action. For "authorize", this will be discovered automatically.'
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
 */
async function handleAuthorize(
  scope: string | undefined,
  appId: string,
  appSecret: string,
  brand: string
): Promise<OAuthResult> {
  log.info('Starting device authorization flow', { scope: scope || 'default' });

  // Default scope if not provided
  const requestedScope = scope || 'contact:user.base:readonly';

  try {
    // Step 1: Request device authorization
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

    // Provide instructions to the user (logging for visibility)
    const instructions = [
      '===========================================',
      'OAuth Authorization Required',
      '===========================================',
      '',
      `Please visit: ${deviceAuth.verificationUri}`,
      `And enter code: ${deviceAuth.userCode}`,
      '',
      `Or visit directly: ${deviceAuth.verificationUriComplete}`,
      '',
      `This code expires in ${Math.floor(deviceAuth.expiresIn / 60)} minutes.`,
      '',
      'Waiting for authorization...',
      '===========================================',
    ].join('\n');
    log.info(instructions);

    // Step 2: Poll for token
    const result = await pollDeviceToken({
      appId,
      appSecret,
      brand: brand as 'feishu' | 'lark',
      deviceCode: deviceAuth.deviceCode,
      interval: deviceAuth.interval,
      expiresIn: deviceAuth.expiresIn,
    });

    if (!result.ok) {
      log.warn('OAuth flow failed', { error: result.error, message: result.message });
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

    // Step 3: Get user info to determine user_open_id
    // Note: We need to call the API with the new token to get user info
    // For now, we'll store the token with a placeholder and the user_open_id
    // will be retrieved from the token introspection or from stored token data
    const { token } = result;

    // Store the token - we need user_open_id which we can get from the token response
    // or by calling the userinfo endpoint. For device flow, the user_open_id is
    // typically returned in the token response or we need to call /authen/v1/user_info

    // Save token with a temporary ID - we'll get the real user_open_id from the API
    // For now, let's try to get user info from the token response
    // Some OAuth providers include user info in the token response
    // If not, we need to call a userinfo endpoint

    // Lark's device flow response doesn't include user_open_id directly
    // We need to call the userinfo API with the access token
    // Let's fetch user info using the access token
    let userOpenId: string;
    try {
      // Use the Lark API to get user info
      const userinfoUrl = brand === 'lark'
        ? 'https://open.larksuite.com/open-apis/authen/v1/user_info'
        : 'https://open.feishu.cn/open-apis/authen/v1/user_info';

      const userinfoResp = await fetch(userinfoUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token.accessToken}`,
        },
      });

      const userinfoData = await userinfoResp.json() as { code?: number; data?: { user?: { open_id?: string } }; msg?: string };

      if (userinfoData.code !== 0 || !userinfoData.data?.user?.open_id) {
        // Fallback: try to get user info via tenant access token
        // Use a placeholder for now - user can find their open_id through other means
        log.warn('Could not fetch user info from API', { code: userinfoData.code, msg: userinfoData.msg });
        userOpenId = 'unknown';
      } else {
        userOpenId = userinfoData.data.user.open_id;
        log.info('Got user open_id from userinfo API', { userOpenId });
      }
    } catch (err) {
      log.warn('Failed to fetch user info', { error: err instanceof Error ? err.message : String(err) });
      userOpenId = 'unknown';
    }

    // Save the token
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
            'Use the status action to check authorization status.',
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
 * Handle 'revoke' action - remove stored token.
 */
async function handleRevoke(
  userOpenId: string | undefined,
  appId: string
): Promise<OAuthResult> {
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
        const statusEmoji = status === 'valid' ? 'valid' : status === 'needs_refresh' ? 'expiring' : 'expired';
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
  const refreshExpiresDate = status.refreshExpiresAt ? new Date(status.refreshExpiresAt).toISOString() : 'unknown';
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
      'Actions:',
      '- authorize: Start OAuth device flow to get user authorization. The user must visit the verification URL and enter the code.',
      '- revoke: Remove stored authorization for a user. If no user_open_id is provided, list all authorizations.',
      '- status: Check authorization status for a user. If no user_open_id is provided, list all authorizations.',
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
      const { action, scope, user_open_id } = args;
      const { config } = context;
      const { appId, appSecret, brand } = config;

      // Validate required config
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

        case 'revoke':
          return handleRevoke(user_open_id, appId);

        case 'status':
          return handleStatus(user_open_id, appId, appSecret, brand ?? 'feishu');

        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action: ${action}. Supported actions: authorize, revoke, status.`,
              },
            ],
            isError: true,
          };
      }
    },
  });

  log.debug('OAuth tool registered');
}
