/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Shared tool helper utilities.
 *
 * Common response formatting and error handling for all tool modules.
 */

import { assertLarkOk } from '../../core/api-error.js';

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
