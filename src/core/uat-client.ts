/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * UAT (User Access Token) API call wrapper for cc-lark MCP Server.
 *
 * Provides a safe, auto-refreshing interface for making Lark API calls on
 * behalf of a user. Tokens are read from file-based storage, refreshed
 * transparently, and never exposed to the AI layer.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import type { LarkBrand } from './types.js';
import {
  getStoredToken,
  setStoredToken,
  removeStoredToken,
  tokenStatus,
  maskToken,
  type StoredUAToken,
} from './token-store.js';
import { resolveOAuthEndpoints } from './device-flow.js';
import { logger } from '../utils/logger.js';
import { getUserAgent } from './version.js';
import {
  REFRESH_TOKEN_IRRECOVERABLE,
  TOKEN_RETRY_CODES,
  NeedAuthorizationError,
} from './api-error.js';

const log = logger('uat-client');

// Re-export for backward compatibility
export { NeedAuthorizationError };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UATCallOptions {
  userOpenId: string;
  appId: string;
  appSecret: string;
  domain: LarkBrand;
}

export interface UATStatus {
  authorized: boolean;
  userOpenId: string;
  scope?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
  grantedAt?: number;
  tokenStatus?: 'valid' | 'needs_refresh' | 'expired';
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Header-aware fetch for Lark API calls.
 */
function larkFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const headers = {
    ...init?.headers,
    'User-Agent': getUserAgent(),
  };

  return fetch(url, { ...init, headers });
}

// ---------------------------------------------------------------------------
// Per-user refresh lock
// ---------------------------------------------------------------------------

/**
 * Guards against concurrent refresh operations for the same user.
 *
 * refresh_token is single-use: if two requests trigger a refresh
 * simultaneously, the second one would use an already-consumed token and
 * fail. The lock ensures only one refresh runs at a time per user.
 */
const refreshLocks = new Map<string, Promise<StoredUAToken | null>>();

// ---------------------------------------------------------------------------
// Refresh implementation
// ---------------------------------------------------------------------------

async function doRefreshToken(
  opts: UATCallOptions,
  stored: StoredUAToken
): Promise<StoredUAToken | null> {
  // refresh_token already expired → can't refresh, need re-auth.
  if (Date.now() >= stored.refreshExpiresAt) {
    log.info(`refresh_token expired for ${opts.userOpenId}, clearing`);
    await removeStoredToken(opts.appId, opts.userOpenId);
    return null;
  }

  const endpoints = resolveOAuthEndpoints(opts.domain);

  const resp = await larkFetch(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
      client_id: opts.appId,
      client_secret: opts.appSecret,
    }).toString(),
  });

  const data = (await resp.json()) as Record<string, unknown>;

  // Lark v2 token endpoint returns `code: 0` on success.
  // Some responses use `error` field instead (standard OAuth).
  const code = data.code as number | undefined;
  const error = data.error as string | undefined;

  if ((code !== undefined && code !== 0) || error) {
    const errCode = code ?? error;
    const errMsg = (data.error_description as string) ?? (data.msg as string) ?? 'unknown';

    // Known irrecoverable codes: invalid/expired/missing refresh_token
    if (REFRESH_TOKEN_IRRECOVERABLE.has(code as number)) {
      log.warn(`refresh failed (code=${errCode}), clearing token for ${opts.userOpenId}`);
      await removeStoredToken(opts.appId, opts.userOpenId);
      return null;
    }

    throw new Error(`Token refresh failed (code=${errCode}): ${errMsg}`);
  }

  if (!data.access_token) {
    throw new Error('Token refresh returned no access_token');
  }

  const now = Date.now();
  const updated: StoredUAToken = {
    userOpenId: stored.userOpenId,
    appId: opts.appId,
    accessToken: data.access_token as string,
    // refresh_token is rotated – always use the new one.
    refreshToken: (data.refresh_token as string) ?? stored.refreshToken,
    expiresAt: now + ((data.expires_in as number) ?? 7200) * 1000,
    refreshExpiresAt: data.refresh_token_expires_in
      ? now + (data.refresh_token_expires_in as number) * 1000
      : stored.refreshExpiresAt,
    scope: (data.scope as string) ?? stored.scope,
    grantedAt: stored.grantedAt,
  };

  await setStoredToken(updated);
  log.info(`refreshed UAT for ${opts.userOpenId} (at:${maskToken(updated.accessToken)})`);
  return updated;
}

/**
 * Refresh with per-user locking.
 */
async function refreshWithLock(
  opts: UATCallOptions,
  stored: StoredUAToken
): Promise<StoredUAToken | null> {
  const key = `${opts.appId}:${opts.userOpenId}`;

  // Another refresh is already in-flight – wait for it and re-read.
  const existing = refreshLocks.get(key);
  if (existing) {
    await existing;
    return getStoredToken(opts.appId, opts.userOpenId);
  }

  const promise = doRefreshToken(opts, stored);
  refreshLocks.set(key, promise);
  try {
    return await promise;
  } finally {
    refreshLocks.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Obtain a valid access_token for the given user.
 *
 * - Reads from storage.
 * - Refreshes proactively if the token is about to expire.
 * - Throws when no token exists or refresh fails irrecoverably.
 *
 * The returned token must never be exposed to the AI layer.
 */
export async function getValidAccessToken(opts: UATCallOptions): Promise<string> {
  const stored = await getStoredToken(opts.appId, opts.userOpenId);
  if (!stored) {
    throw new NeedAuthorizationError(opts.userOpenId);
  }

  const status = tokenStatus(stored);

  if (status === 'valid') {
    return stored.accessToken;
  }

  if (status === 'needs_refresh') {
    const refreshed = await refreshWithLock(opts, stored);
    if (!refreshed) {
      throw new NeedAuthorizationError(opts.userOpenId);
    }
    return refreshed.accessToken;
  }

  // expired
  await removeStoredToken(opts.appId, opts.userOpenId);
  throw new NeedAuthorizationError(opts.userOpenId);
}

/**
 * Execute an API call with a valid UAT, retrying once on token-expiry errors.
 */
export async function callWithUAT<T>(
  opts: UATCallOptions,
  apiCall: (accessToken: string) => Promise<T>
): Promise<T> {
  const accessToken = await getValidAccessToken(opts);
  try {
    return await apiCall(accessToken);
  } catch (err: unknown) {
    // Retry once if the server reports token invalid/expired.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (err as any)?.code ?? (err as any)?.response?.data?.code;
    if (TOKEN_RETRY_CODES.has(code as number)) {
      log.warn(`API call failed (code=${code}), refreshing and retrying`);
      const stored = await getStoredToken(opts.appId, opts.userOpenId);
      if (!stored) throw new NeedAuthorizationError(opts.userOpenId);
      const refreshed = await refreshWithLock(opts, stored);
      if (!refreshed) throw new NeedAuthorizationError(opts.userOpenId);
      return await apiCall(refreshed.accessToken);
    }
    throw err;
  }
}

/**
 * Get the current UAT status for a user.
 */
export async function getUATStatus(opts: UATCallOptions): Promise<UATStatus> {
  const stored = await getStoredToken(opts.appId, opts.userOpenId);
  if (!stored) {
    return {
      authorized: false,
      userOpenId: opts.userOpenId,
    };
  }

  const status = tokenStatus(stored);
  return {
    authorized: status !== 'expired',
    userOpenId: opts.userOpenId,
    scope: stored.scope,
    expiresAt: stored.expiresAt,
    refreshExpiresAt: stored.refreshExpiresAt,
    grantedAt: stored.grantedAt,
    tokenStatus: status,
  };
}

/**
 * Save a new token from OAuth device flow.
 */
export async function saveTokenFromDeviceFlow(
  opts: UATCallOptions,
  tokenData: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    refreshExpiresIn: number;
    scope: string;
  }
): Promise<StoredUAToken> {
  const now = Date.now();
  const stored: StoredUAToken = {
    userOpenId: opts.userOpenId,
    appId: opts.appId,
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresAt: now + tokenData.expiresIn * 1000,
    refreshExpiresAt: now + tokenData.refreshExpiresIn * 1000,
    scope: tokenData.scope,
    grantedAt: now,
  };

  await setStoredToken(stored);
  return stored;
}

/**
 * Revoke a user's UAT by removing it from storage.
 */
export async function revokeUAT(appId: string, userOpenId: string): Promise<void> {
  await removeStoredToken(appId, userOpenId);
  log.info(`revoked UAT for ${userOpenId}`);
}
