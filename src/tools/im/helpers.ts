/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * IM Tools helper utilities.
 *
 * Re-exports shared helpers from common/helpers.ts and adds IM-specific utilities.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';

// Re-export shared helpers for backward compatibility
export { json, jsonError, assertLarkOk, type ToolResult } from '../common/helpers.js';

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
// Zod schemas
// ---------------------------------------------------------------------------

/** Common pagination schema */
export const paginationSchema = {
  page_size: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .describe('Number of results per page (1-50), default 50'),
  page_token: z.string().optional().describe('Pagination token for next page'),
};

/** Sort rule schema for messages */
export const sortRuleSchema = z
  .enum(['create_time_asc', 'create_time_desc'])
  .optional()
  .describe(
    'Sort order: create_time_asc (oldest first) or create_time_desc (newest first, default)'
  );
