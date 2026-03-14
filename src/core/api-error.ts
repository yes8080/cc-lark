/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Shared Lark API error handling utilities.
 *
 * Provides unified error handling for two distinct error paths:
 *
 * 1. **Response-level errors** — The SDK returns a response object with a
 *    non-zero `code`.  Handled by {@link assertLarkOk}.
 *
 * 2. **Thrown exceptions** — The SDK throws an Axios-style error (HTTP 4xx)
 *    whose properties include the Feishu error `code` and `msg`.
 *    Handled by {@link formatLarkError}.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

// ---------------------------------------------------------------------------
// Well-known Lark error codes
// ---------------------------------------------------------------------------

/**
 * Well-known Lark API error codes.
 * @see https://open.feishu.cn/document/ukTMukTMukTM/ugTM5UjL4ETO14COxkTN/code
 */
export const LARK_ERROR = {
  /** Success */
  SUCCESS: 0,
  /** Permission denied - app scope missing (tenant level) */
  APP_SCOPE_MISSING: 99991672,
  /** User token scope insufficient */
  USER_SCOPE_INSUFFICIENT: 99991679,
  /** Invalid access token */
  INVALID_ACCESS_TOKEN: 99991663,
  /** Access token expired */
  ACCESS_TOKEN_EXPIRED: 99991664,
  /** access_token invalid */
  TOKEN_INVALID: 99991668,
  /** access_token expired */
  TOKEN_EXPIRED: 99991669,
  /** refresh_token invalid */
  REFRESH_TOKEN_INVALID: 20003,
  /** refresh_token expired */
  REFRESH_TOKEN_EXPIRED: 20004,
  /** refresh_token missing */
  REFRESH_TOKEN_MISSING: 20024,
  /** refresh_token revoked */
  REFRESH_TOKEN_REVOKED: 20063,
  /** Message recalled */
  MESSAGE_RECALLED: 230011,
  /** Message deleted */
  MESSAGE_DELETED: 231003,
} as const;

// ---------------------------------------------------------------------------
// Code extraction
// ---------------------------------------------------------------------------

/**
 * Coerce a value to a number if possible.
 */
function coerceCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Extract the Lark API code from a thrown error object.
 *
 * Supports three common structures:
 * - `{ code }` — SDK direct mount
 * - `{ data: { code } }` — Response body nested
 * - `{ response: { data: { code } } }` — Axios style
 */
export function extractLarkApiCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;

  const e = err as {
    code?: unknown;
    data?: { code?: unknown };
    response?: { data?: { code?: unknown } };
  };

  return coerceCode(e.code) ?? coerceCode(e.data?.code) ?? coerceCode(e.response?.data?.code);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assert that a Lark SDK response is successful (code === 0).
 *
 * @param res - Lark SDK response object
 * @throws Error with the message from the response if code is non-zero
 */
export function assertLarkOk(res: { code?: number; msg?: string }): void {
  if (!res.code || res.code === 0) return;

  throw new Error(res.msg ?? `Feishu API error (code: ${res.code})`);
}

/**
 * Extract a meaningful error message from a thrown Lark SDK / Axios error.
 *
 * The Lark SDK throws Axios errors whose object carries Feishu-specific
 * fields (`code`, `msg`) alongside the standard `message`. For all errors
 * we try `err.msg` first (the Feishu detail) and fall back to `err.message`
 * (the generic Axios text).
 */
export function formatLarkError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return String(err);
  }
  const e = err as {
    code?: number;
    msg?: string;
    message?: string;
    response?: { data?: { code?: number; msg?: string } };
  };

  // Path 1: Lark SDK merges Feishu fields onto the thrown error object.
  if (typeof e.code === 'number' && e.msg) {
    return e.msg;
  }

  // Path 2: Standard Axios error — dig into response.data.
  const data = e.response?.data;
  if (data && typeof data.code === 'number' && data.msg) {
    return data.msg;
  }

  // Fallback.
  return e.message ?? String(err);
}

/**
 * Check if an error indicates missing app scope/permission.
 */
export function isPermissionError(err: unknown): boolean {
  const code = extractLarkApiCode(err);
  return code === LARK_ERROR.APP_SCOPE_MISSING;
}

/**
 * Check if an error indicates an invalid or expired access token.
 */
export function isTokenError(err: unknown): boolean {
  const code = extractLarkApiCode(err);
  return code === LARK_ERROR.INVALID_ACCESS_TOKEN || code === LARK_ERROR.ACCESS_TOKEN_EXPIRED;
}

// ---------------------------------------------------------------------------
// Error code sets
// ---------------------------------------------------------------------------

/** Irrecoverable refresh_token error codes - require re-authorization */
export const REFRESH_TOKEN_IRRECOVERABLE: ReadonlySet<number> = new Set([
  LARK_ERROR.REFRESH_TOKEN_INVALID,
  LARK_ERROR.REFRESH_TOKEN_EXPIRED,
  LARK_ERROR.REFRESH_TOKEN_MISSING,
  LARK_ERROR.REFRESH_TOKEN_REVOKED,
]);

/** Message terminal error codes (recalled/deleted) - stop further operations */
export const MESSAGE_TERMINAL_CODES: ReadonlySet<number> = new Set([
  LARK_ERROR.MESSAGE_RECALLED,
  LARK_ERROR.MESSAGE_DELETED,
]);

/** access_token failure error codes - can retry with refresh */
export const TOKEN_RETRY_CODES: ReadonlySet<number> = new Set([
  LARK_ERROR.TOKEN_INVALID,
  LARK_ERROR.TOKEN_EXPIRED,
]);

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Scope error information */
export interface ScopeErrorInfo {
  apiName: string;
  scopes: string[];
  /** Whether app scope has been verified */
  appScopeVerified?: boolean;
  /** Application ID for generating permission management links */
  appId?: string;
}

/** OAuth authorization hint for client */
export interface AuthHint {
  error: string;
  api: string;
  required_scope: string;
  user_open_id: string;
  message: string;
  next_tool_call: {
    tool: 'feishu_oauth';
    params: { action: 'authorize'; scope: string };
  };
}

/** tryInvoke return type - discriminated union */
export type TryInvokeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; authHint: AuthHint }
  | { ok: false; error: string; authHint?: undefined };

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when no valid UAT exists and the user needs to (re-)authorize.
 * Callers should catch this and trigger the OAuth flow.
 */
export class NeedAuthorizationError extends Error {
  readonly userOpenId: string;

  constructor(userOpenId: string) {
    super('need_user_authorization');
    this.name = 'NeedAuthorizationError';
    this.userOpenId = userOpenId;
  }
}

/**
 * Thrown when the app lacks the application:application:self_manage permission.
 *
 * The administrator needs to enable this permission in the Lark Developer Console.
 */
export class AppScopeCheckFailedError extends Error {
  readonly appId?: string;

  constructor(appId?: string) {
    super(
      'App lacks application:application:self_manage permission. ' +
        'Please ask the administrator to enable this permission in the Developer Console.'
    );
    this.name = 'AppScopeCheckFailedError';
    this.appId = appId;
  }
}

/**
 * Thrown when the app is missing required OAPI scopes.
 *
 * The administrator needs to enable permissions in the Lark Developer Console.
 */
export class AppScopeMissingError extends Error {
  readonly apiName: string;
  /** Missing scopes that the app doesn't have */
  readonly missingScopes: string[];
  /** All required scopes (including enabled ones), for requesting user authorization after app permission setup */
  readonly allRequiredScopes?: string[];
  /** Application ID for generating permission management links */
  readonly appId?: string;
  readonly scopeNeedType?: 'one' | 'all';
  /** Token type used when this error was triggered */
  readonly tokenType?: 'user' | 'tenant';

  constructor(
    info: ScopeErrorInfo,
    scopeNeedType?: 'one' | 'all',
    tokenType?: 'user' | 'tenant',
    allRequiredScopes?: string[]
  ) {
    if (scopeNeedType === 'one') {
      super(
        `App missing permission [${info.scopes.join(', ')}] ` +
          '(enable any one of these). Please ask the administrator to enable in Developer Console.'
      );
    } else {
      super(
        `App missing permission [${info.scopes.join(', ')}]. ` +
          'Please ask the administrator to enable in Developer Console.'
      );
    }
    this.name = 'AppScopeMissingError';
    this.apiName = info.apiName;
    this.missingScopes = info.scopes;
    this.allRequiredScopes = allRequiredScopes;
    this.appId = info.appId;
    this.scopeNeedType = scopeNeedType;
    this.tokenType = tokenType;
  }
}

/**
 * Thrown when user has not authorized or scope is insufficient.
 *
 * `requiredScopes` contains valid scopes from APP∩OAPI intersection,
 * can be passed directly to OAuth authorize.
 */
export class UserAuthRequiredError extends Error {
  readonly userOpenId: string;
  readonly apiName: string;
  /** APP∩OAPI intersection scopes, pass to OAuth authorize */
  readonly requiredScopes: string[];
  /** Whether app scope was verified. false means requiredScopes may be inaccurate. */
  readonly appScopeVerified: boolean;
  /** Application ID for generating permission management links */
  readonly appId?: string;

  constructor(userOpenId: string, info: ScopeErrorInfo) {
    super('need_user_authorization');
    this.name = 'UserAuthRequiredError';
    this.userOpenId = userOpenId;
    this.apiName = info.apiName;
    this.requiredScopes = info.scopes;
    this.appId = info.appId;
    this.appScopeVerified = info.appScopeVerified ?? true;
  }
}

/**
 * Thrown when server returns 99991679 - user token scope insufficient.
 *
 * Requires incremental authorization: start a new Device Flow with missing scopes.
 */
export class UserScopeInsufficientError extends Error {
  readonly userOpenId: string;
  readonly apiName: string;
  /** Missing scope list */
  readonly missingScopes: string[];

  constructor(userOpenId: string, info: ScopeErrorInfo) {
    super('user_scope_insufficient');
    this.name = 'UserScopeInsufficientError';
    this.userOpenId = userOpenId;
    this.apiName = info.apiName;
    this.missingScopes = info.scopes;
  }
}
