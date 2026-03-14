/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * IM Tools helper utilities.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import { assertLarkOk } from '../../core/api-error.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:im:helpers');

// ---------------------------------------------------------------------------
// User name cache
// ---------------------------------------------------------------------------

/** In-memory cache for user names (userOpenId -> name) */
const userNameCache = new Map<string, { name: string; expiresAt: number }>();

const USER_NAME_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get a cached user name.
 */
export function getCachedUserName(userOpenId: string): string | undefined {
  const entry = userNameCache.get(userOpenId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    userNameCache.delete(userOpenId);
    return undefined;
  }
  return entry.name;
}

/**
 * Cache a user name.
 */
export function setCachedUserName(userOpenId: string, name: string): void {
  userNameCache.set(userOpenId, {
    name,
    expiresAt: Date.now() + USER_NAME_CACHE_TTL_MS,
  });
}

/**
 * Batch cache user names.
 */
export function setCachedUserNames(entries: Map<string, string>): void {
  const now = Date.now();
  for (const [openId, name] of entries) {
    userNameCache.set(openId, { name, expiresAt: now + USER_NAME_CACHE_TTL_MS });
  }
}

// ---------------------------------------------------------------------------
// API response handling
// ---------------------------------------------------------------------------

/**
 * Tool result type that matches MCP SDK expectations.
 */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/**
 * Format a successful tool result.
 */
export function json(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Format an error tool result.
 */
export function jsonError(message: string, details?: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message, details }, null, 2) }],
    isError: true,
  };
}

/**
 * Assert that a Lark API response is successful (code === 0).
 * Throws an error with the API message if the response indicates failure.
 */
export { assertLarkOk };

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Common pagination schema */
export const paginationSchema = {
  page_size: z.number().min(1).max(50).optional().describe('Number of results per page (1-50), default 50'),
  page_token: z.string().optional().describe('Pagination token for next page'),
};

/** Sort rule schema for messages */
export const sortRuleSchema = z
  .enum(['create_time_asc', 'create_time_desc'])
  .optional()
  .describe('Sort order: create_time_asc (oldest first) or create_time_desc (newest first, default)');
