/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Authentication error types for cc-lark MCP Server.
 *
 * Re-exports error types from api-error.ts for convenience.
 * This module provides backward compatibility and a dedicated import path.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

// Re-export everything from api-error.ts
export {
  LARK_ERROR,
  REFRESH_TOKEN_IRRECOVERABLE,
  MESSAGE_TERMINAL_CODES,
  TOKEN_RETRY_CODES,
  ScopeErrorInfo,
  AuthHint,
  TryInvokeResult,
  NeedAuthorizationError,
  AppScopeCheckFailedError,
  AppScopeMissingError,
  UserAuthRequiredError,
  UserScopeInsufficientError,
} from './api-error.js';
